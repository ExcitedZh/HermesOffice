/** Smoke tests for the local HTML→pptx converter (html-to-pptx.ts). */
import { describe, it, expect } from 'vitest'
import { convertHtmlPage } from '../src/main/html-to-pptx'
import { openPptx } from '@hermesoffice/pptx-engine'

const SAMPLE = `
<div id="slide" style="background:#FFFFFF">
  <div style="position:absolute;left:0;top:0;width:1280;height:140;background:#2563EB">
    <h1 style="font-size:44;color:#FFFFFF;text-align:center;font-weight:bold">Product Launch</h1>
  </div>
  <div style="position:absolute;left:80;top:180;width:560;height:400;background:#F8FAFC;border-radius:16">
    <h2 style="font-size:28;color:#1A1A2E">Key points</h2>
    <ul>
      <li style="font-size:18;color:#333">First point</li>
      <li style="font-size:18;color:#333">Second point</li>
    </ul>
  </div>
  <table style="position:absolute;left:680;top:180;width:520;height:300">
    <tr><td>Metric</td><td>Value</td></tr>
    <tr><td>Revenue</td><td class="v">48亿</td></tr>
  </table>
</div>
`

describe('convertHtmlPage', () => {
  it('produces a parseable single-slide pptx with text/shape/table/background', async () => {
    const { bytes, imageFailures } = await convertHtmlPage(SAMPLE)
    expect(imageFailures).toEqual([])
    const opened = await openPptx(bytes)
    expect(opened.deck.slides).toHaveLength(1)
    const slide = opened.deck.slides[0]!
    // background applied
    expect(slide.background?.type).toBe('solid')
    // title bar (shape with text), text panel (shape with text), table → shape + table
    const types = slide.elements.map((e) => e.type)
    expect(types).toContain('shape')
    expect(types).toContain('table')
    // text present in the shape text boxes
    const allText = slide.elements
      .map((e) => (e as { text?: { paragraphs: Array<{ runs: Array<{ text: string }> }> } }).text)
      .filter(Boolean)
      .flatMap((t) => t!.paragraphs.flatMap((p) => p.runs.map((r) => r.text)))
      .join(' ')
    expect(allText).toContain('Product Launch')
    expect(allText).toContain('First point')
    // table cell text present
    const table = slide.elements.find((e) => e.type === 'table') as {
      rows: Array<Array<{ text?: { paragraphs: Array<{ runs: Array<{ text: string }> }> } }>>
    }
    const tableText = table.rows
      .flat()
      .map((c) => c.text?.paragraphs.flatMap((p) => p.runs.map((r) => r.text)).join('') ?? '')
      .join(' ')
    expect(tableText).toContain('Revenue')
    expect(tableText).toContain('48亿')
  })

  it('ignores a box without geometry and skips non-http images silently', async () => {
    const { bytes, imageFailures } = await convertHtmlPage(
      '<div id="slide"><div style="position:absolute;left:0;top:0;width:100;height:50">ok</div><img src="not-a-url"/></div>',
    )
    expect(imageFailures).toEqual([])
    const opened = await openPptx(bytes)
    expect(opened.deck.slides[0]!.elements.length).toBe(1)
  })
})
