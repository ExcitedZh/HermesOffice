/**
 * Local HTML→PPTX single-page converter.
 *
 * Replaces the gsk cloud `slide_generate` service: the deck's per-page HTML is
 * parsed here in the main process and turned into editable native PowerPoint
 * elements (text boxes, shapes, pictures, tables) inside a blank single-slide
 * pptx. The existing merge/landing pipeline (mergeSlideFromPptx) consumes the
 * resulting bytes unchanged, so no cloud service or gsk login is required.
 *
 * Coordinate model: deck canvas is 1280×720 px at 96 DPI (16:9 ⇒ 12192000×6858000
 * EMU), so 1 px = EMU_PER_PX_96. The LLM is prompted to emit absolutely-positioned
 * boxes in px within that canvas.
 */
import {
  openPptx,
  createBlankPptx,
  savePptx,
  setSlideBackground,
  appendRawElements,
  materializeSlide,
  addPicture,
  buildSpXml,
  buildTableXml,
  generateParagraphXml,
  type EmuRect,
  type Paragraph,
  type TextRun,
} from '@hermesoffice/pptx-engine'
import { EMU_PER_PX_96 } from '@hermesoffice/pptx-render'
import { fetchRemoteImage } from '@hermesoffice/electron-utils'

export interface ConvertedPage {
  bytes: Uint8Array
  /** Remote image URLs that failed to download (landed as text/shape but no picture). */
  imageFailures: string[]
}

// ── Minimal HTML tokenizer → light DOM ──────────────────────────────────

interface VNode {
  tag: string
  attrs: Record<string, string>
  style: Record<string, string>
  children: VNode[]
  /** Text content for #text nodes. */
  text?: string
}

const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source'])

function parseStyle(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of s.split(';')) {
    const i = part.indexOf(':')
    if (i < 0) continue
    const k = part.slice(0, i).trim().toLowerCase()
    const v = part.slice(i + 1).trim()
    if (k) out[k] = v
  }
  return out
}

function parseAttrs(tagS: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tagS.matchAll(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g)) out[m[1].toLowerCase()] = m[2]
  return out
}

function parseHtml(html: string): VNode {
  const root: VNode = { tag: '#root', attrs: {}, style: {}, children: [] }
  const stack: VNode[] = [root]
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s[^<>]*?)?)(\/?)>|([^<]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const [, close, tagRaw, rest, selfClose, text] = m
    if (text !== undefined) {
      const t = text.replace(/\s+/g, ' ')
      if (t.trim())
        stack[stack.length - 1]!.children.push({
          tag: '#text',
          attrs: {},
          style: {},
          children: [],
          text: t.trim(),
        })
      continue
    }
    const tag = (tagRaw || '').toLowerCase()
    if (close) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]!.tag === tag) {
          stack.length = i // pop the closing element (keep 0..i-1)
          break
        }
      }
      continue
    }
    const styleAttr = /\sstyle\s*=\s*"([^"]*)"/i.exec(rest ?? '')
    const node: VNode = {
      tag,
      attrs: parseAttrs(rest ?? ''),
      style: parseStyle(styleAttr?.[1] ?? ''),
      children: [],
    }
    stack[stack.length - 1]!.children.push(node)
    if (!selfClose && !VOID_TAGS.has(tag)) stack.push(node)
  }
  return root
}

// ── Style helpers ───────────────────────────────────────────────────────

function px(v: string | undefined): number | undefined {
  if (v === undefined) return undefined
  const n = parseFloat(v.replace(/px$/i, ''))
  return Number.isFinite(n) ? n : undefined
}

function color(v: string | undefined): string | undefined {
  if (!v) return undefined
  const m = /^#([0-9a-fA-F]{3,8})$/.exec(v.trim())
  if (!m) return undefined
  let hex = m[1]!
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c)
  return '#' + hex.toUpperCase()
}

function alignOf(v: string | undefined): Paragraph['align'] | undefined {
  const t = (v ?? '').trim().toLowerCase()
  if (t === 'left' || t === 'center' || t === 'right' || t === 'justify') return t
  return undefined
}

function lineHeightOf(v: string | undefined): { lineHeight?: number; lineExact?: number } {
  if (v === undefined) return {}
  const t = v.trim()
  const ratio = parseFloat(t)
  if (Number.isFinite(ratio)) {
    if (t.endsWith('px')) return { lineExact: Math.round(ratio * 0.75) } // px → pt
    return { lineHeight: Math.round(ratio * 100) } // unitless ratio → %
  }
  return {}
}

interface TextStyle {
  fs?: number
  color?: string
  bold?: boolean
  italic?: boolean
  align?: Paragraph['align']
  font?: string
  lineHeight?: number
  lineExact?: number
}

function textRun(text: string, st: TextStyle): TextRun {
  const r: TextRun = { text }
  if (st.fs) r.fontSize = st.fs
  if (st.color) r.color = st.color
  if (st.bold) r.bold = true
  if (st.italic) r.italic = true
  if (st.font) r.fontFamily = st.font
  return r
}

const BLOCK_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'section'])
const STRONG_TAGS = new Set(['strong', 'b', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const ITALIC_TAGS = new Set(['em', 'i'])

/** Convert a node's inline content into Paragraph[] (block children start new paragraphs, li get bullets). */
function nodeParagraphs(node: VNode): Paragraph[] {
  const paras: Paragraph[] = []
  let cur: Paragraph | null = null
  const flush = () => {
    if (cur && cur.runs.some((r) => r.text.trim())) paras.push(cur)
    cur = null
  }
  const ensure = (st: TextStyle) => {
    if (!cur) cur = { runs: [], ...(st.align ? { align: st.align } : {}) }
  }

  function walk(n: VNode, ctx: TextStyle): void {
    if (n.tag === '#text') {
      const t = n.text?.replace(/\s+/g, ' ').trim()
      if (!t) return
      ensure(ctx)
      cur!.runs.push(textRun(t, ctx))
      return
    }
    const s = n.style
    const c: TextStyle = {
      ...ctx,
      fs: px(s['font-size']) ?? ctx.fs,
      color: color(s.color) ?? ctx.color,
      bold: s['font-weight'] === 'bold' ? true : STRONG_TAGS.has(n.tag) ? true : ctx.bold,
      italic: s['font-style'] === 'italic' ? true : ITALIC_TAGS.has(n.tag) ? true : ctx.italic,
      align: alignOf(s['text-align']) ?? ctx.align,
      font: s['font-family'] ?? ctx.font,
      ...lineHeightOf(s['line-height']),
    }
    if (BLOCK_TAGS.has(n.tag)) {
      flush()
      cur = { runs: [], ...(c.align ? { align: c.align } : {}) }
      for (const ch of n.children) walk(ch, c)
      flush()
      return
    }
    if (n.tag === 'li') {
      flush()
      cur = {
        runs: [],
        ...(c.align ? { align: c.align } : {}),
        bullet: { type: 'char', char: '•' },
        ...(c.lineHeight ? { lineHeight: c.lineHeight } : {}),
        ...(c.lineExact ? { lineExact: c.lineExact } : {}),
      }
      for (const ch of n.children) walk(ch, c)
      flush()
      return
    }
    // Inline / container (span, strong, b, em, i, a, font, ul, ol, table, thead/tbody/tr/td…):
    // just recurse; block/li handling above manages paragraph boundaries.
    for (const ch of n.children) walk(ch, c)
  }

  walk(node, {})
  flush()
  return paras
}

// ── Box collection ──────────────────────────────────────────────────────

interface Box {
  kind: 'text' | 'shape' | 'image' | 'table'
  x: number
  y: number
  w: number
  h: number
  bg?: string
  radius?: number
  paragraphs: Paragraph[]
  imageUrl?: string
  tableCells?: string[][]
}

function tableCells(node: VNode): string[][] {
  const rows: string[][] = []
  const textOf = (n: VNode): string => {
    if (n.tag === '#text') return n.text ?? ''
    return n.children.map(textOf).join('').trim()
  }
  // Simple: collect each <tr> sibling; within, each <td>/<th> text.
  const trs = node.children.filter((c) => c.tag === 'tr')
  for (const tr of trs) {
    const cellsInRow: string[] = []
    for (const cell of tr.children) {
      if (cell.tag === 'td' || cell.tag === 'th') cellsInRow.push(textOf(cell).trim())
    }
    rows.push(cellsInRow)
  }
  return rows
}

function boxFromNode(node: VNode): Box | null {
  const s = node.style
  const x = px(s.left ?? s.x)
  const y = px(s.top ?? s.y)
  const w = px(s.width)
  const h = px(s.height)
  if (x === undefined || y === undefined) return null
  const bg = color(s['background-color'] ?? s.background)
  const radius = px(s['border-radius'])

  if (node.tag === 'img') {
    const src = String(node.attrs.src ?? '').trim()
    if (!/^https?:\/\//i.test(src)) return null
    return {
      kind: 'image',
      x,
      y,
      w: w ?? 300,
      h: h ?? 200,
      imageUrl: src,
      paragraphs: [],
    }
  }

  if (node.tag === 'table') {
    return {
      kind: 'table',
      x,
      y,
      w: w ?? 800,
      h: h ?? 300,
      bg,
      tableCells: tableCells(node),
      paragraphs: [],
    }
  }

  const paras = nodeParagraphs(node)
  if (!paras.length && !bg) return null // empty transparent spacer
  const isShape = !!bg || !!radius
  return {
    kind: isShape ? 'shape' : 'text',
    x,
    y,
    w: w ?? 400,
    h: h ?? 100,
    bg,
    radius,
    paragraphs: paras,
  }
}

// ── pptx element builders ───────────────────────────────────────────────

const toEmu = (pxVal: number) => Math.round(pxVal * EMU_PER_PX_96)

/** Next <p:cNvPr id> to use on the slide (max existing + 1), mirroring pptx-engine's nextCNvPrId. */
function slideNextId(slide: {
  originalXml: string
  elements: Array<{ anchor: { originalXml: string } }>
}): number {
  let max = 1
  const scan = (xml: string) => {
    for (const m of xml.matchAll(/<p:cNvPr\s[^>]*\bid="(\d+)"/g)) max = Math.max(max, Number(m[1]))
  }
  scan(slide.originalXml)
  for (const el of slide.elements) scan(el.anchor.originalXml)
  return max + 1
}

function buildTableXmlWithText(
  slide: Parameters<typeof buildTableXml>[0],
  opts: { rows: number; cols: number; offset: EmuRect },
  cells: string[][],
): string {
  const id = slideNextId(slide)
  const rows = Math.max(1, opts.rows)
  const cols = Math.max(1, opts.cols)
  const colW = Math.max(1, Math.floor(opts.offset.cx / cols))
  const rowH = Math.max(1, Math.floor(opts.offset.cy / rows))
  const grid = Array.from({ length: cols }, () => `<a:gridCol w="${colW}"/>`).join('')
  const trs = Array.from({ length: rows }, (_, ri) => {
    const tds = Array.from({ length: cols }, (_, ci) => {
      const text = cells[ri]?.[ci] ?? ''
      const paras = text
        ? text
            .split('\n')
            .map((line) => generateParagraphXml({ runs: [{ text: line }] }))
            .join('')
        : '<a:p/>'
      return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${paras}</a:txBody><a:tcPr/></a:tc>`
    }).join('')
    return `<a:tr h="${rowH}">${tds}</a:tr>`
  }).join('')
  return (
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/>` +
    '<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>' +
    `<p:xfrm><a:off x="${opts.offset.x}" y="${opts.offset.y}"/><a:ext cx="${opts.offset.cx}" cy="${opts.offset.cy}"/></p:xfrm>` +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">' +
    `<a:tbl><a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}</a:tableStyleId></a:tblPr>` +
    `<a:tblGrid>${grid}</a:tblGrid>${trs}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
  )
}

/**
 * Build a single-slide pptx from one page of HTML.
 * @param html page HTML written by the LLM (constrained schema, see the prompt)
 * @returns pptx bytes + remote-image failures
 */
export async function convertHtmlPage(html: string): Promise<ConvertedPage> {
  const root = parseHtml(html)
  const body =
    root.children.find((c) => c.tag === 'body') ??
    root.children.find(
      (c) =>
        c.tag === 'div' &&
        c.style &&
        (c.attrs.id === 'slide' || c.attrs['class']?.includes('slide')),
    ) ??
    root

  const opened = await openPptx(await createBlankPptx())
  const slide = opened.deck.slides[0]
  if (!slide) throw new Error('blank pptx has no slide')

  const bodyBg = color(body.style['background-color'] ?? body.style.background)
  if (bodyBg) setSlideBackground(slide, bodyBg)

  const failures: string[] = []
  const boxes: Box[] = []
  for (const child of body.children) {
    if (child.tag === '#text') continue
    const b = boxFromNode(child)
    if (b) boxes.push(b)
  }

  // Append element-by-element in document order so cNvPr ids stay unique and
  // z-order matches the HTML (backgrounds first, foreground last).
  // Note: appendRawElements/materializeSlide reparse, replacing opened.deck.slides[0]
  // with a fresh object each time, so re-read the current slide in every iteration.
  for (const box of boxes) {
    const curSlide = opened.deck.slides[0]
    const offset: EmuRect = { x: toEmu(box.x), y: toEmu(box.y), cx: toEmu(box.w), cy: toEmu(box.h) }
    if (box.kind === 'image') {
      const resp = await fetchRemoteImage(box.imageUrl!)
      if (!resp || !resp.ok) {
        failures.push(box.imageUrl!)
        continue
      }
      const buf = Buffer.from(await resp.arrayBuffer())
      const ct = resp.headers.get('content-type') ?? ''
      const ext = ct.includes('png') ? 'png' : ct.includes('gif') ? 'gif' : 'jpg'
      const el = addPicture(opened, curSlide, {
        bytes: new Uint8Array(buf),
        ext,
        offset,
      })
      if (!el) {
        failures.push(box.imageUrl!)
        continue
      }
      materializeSlide(opened, 0)
      continue
    }
    if (box.kind === 'table') {
      const cols = Math.max(1, box.tableCells?.[0]?.length ?? 1)
      const rows = Math.max(1, box.tableCells?.length ?? 1)
      const xml = buildTableXmlWithText(curSlide, { rows, cols, offset }, box.tableCells ?? [])
      appendRawElements(opened, 0, [xml])
      continue
    }
    // text / shape
    const kind = box.kind === 'shape' ? (box.radius ? 'roundRect' : 'rect') : 'textbox'
    const xml = buildSpXml(curSlide, {
      kind,
      offset,
      paragraphs: box.paragraphs,
      ...(box.bg ? { fillColor: box.bg } : {}),
    })
    appendRawElements(opened, 0, [xml])
  }

  const bytes = await savePptx(opened)
  return { bytes, imageFailures: failures }
}
