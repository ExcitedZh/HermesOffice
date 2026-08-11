import { Fragment, type ReactNode } from 'react'

/**
 * Minimal dependency-free markdown for chat bubbles: paragraphs, ul/ol,
 * headings, **bold**, *italic*, `inline code`, and links `[label](url)`.
 * Tolerates partial (streaming) input — anything unrecognized renders as
 * plain text.
 */

const INLINE_RE = /(`[^`\n]+`|\*\*[^*\n]+?\*\*|\*[^*\n]+?\*|\[[^\]\n]+\]\([^)\n]+\))/g

function renderInline(text: string, onLinkClick?: (url: string) => void): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  for (const m of text.matchAll(INLINE_RE)) {
    const i = m.index ?? 0
    if (i > last) out.push(text.slice(last, i))
    const tok = m[0] ?? ''
    if (tok.startsWith('`')) out.push(<code key={key++}>{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('**')) out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('*')) out.push(<em key={key++}>{tok.slice(1, -1)}</em>)
    else {
      // [label](url) — clicável; onLinkClick decide o que fazer (ex: abrir arquivo)
      const m2 = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)
      const label = m2?.[1] ?? tok
      const url = m2?.[2] ?? ''
      out.push(
        <a
          key={key++}
          className="ai-md-link"
          href="#"
          onClick={(e) => {
            e.preventDefault()
            onLinkClick?.(url)
          }}
        >
          {label}
        </a>,
      )
    }
    last = i + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

type MdBlock =
  | { kind: 'p'; lines: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'h'; text: string }

function parseBlocks(text: string): MdBlock[] {
  const blocks: MdBlock[] = []
  let cur: MdBlock | null = null
  const flush = (): void => {
    if (cur) {
      blocks.push(cur)
      cur = null
    }
  }
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flush()
      continue
    }
    const h = /^#{1,6}\s+(.*)$/.exec(line)
    if (h) {
      flush()
      blocks.push({ kind: 'h', text: h[1] ?? '' })
      continue
    }
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line)
    if (ul) {
      if (cur?.kind !== 'ul') {
        flush()
        cur = { kind: 'ul', items: [] }
      }
      cur.items.push(ul[1] ?? '')
      continue
    }
    const ol = /^\s*\d+[.、)]\s+(.*)$/.exec(line)
    if (ol) {
      if (cur?.kind !== 'ol') {
        flush()
        cur = { kind: 'ol', items: [] }
      }
      cur.items.push(ol[1] ?? '')
      continue
    }
    if (cur?.kind !== 'p') {
      flush()
      cur = { kind: 'p', lines: [] }
    }
    cur.lines.push(line)
  }
  flush()
  return blocks
}

export interface MarkdownProps {
  text: string
  /** Invoked when the user clicks a [label](url) link; caller decides what to do */
  onLinkClick?: (url: string) => void
}

export function Markdown({ text, onLinkClick }: MarkdownProps): React.JSX.Element {
  return (
    <div className="ai-md">
      {parseBlocks(text).map((b, i) => {
        if (b.kind === 'h') {
          return (
            <p key={i} className="ai-md-h">
              {renderInline(b.text, onLinkClick)}
            </p>
          )
        }
        if (b.kind === 'ul' || b.kind === 'ol') {
          const items = b.items.map((it, j) => (
            <li key={j}>{renderInline(it, onLinkClick)}</li>
          ))
          return b.kind === 'ul' ? <ul key={i}>{items}</ul> : <ol key={i}>{items}</ol>
        }
        return (
          <p key={i}>
            {b.lines.map((ln, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {renderInline(ln, onLinkClick)}
              </Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}
