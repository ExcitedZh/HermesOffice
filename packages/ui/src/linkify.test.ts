import { describe, expect, it } from 'vitest'
import { linkifyPaths } from './linkify'

describe('linkifyPaths', () => {
  it('links POSIX paths', () => {
    expect(linkifyPaths('see /Users/gustavo/Documents/teste.docx')).toBe(
      'see [teste.docx](/Users/gustavo/Documents/teste.docx)',
    )
    expect(linkifyPaths('/tmp/a.pdf')).toBe('[a.pdf](/tmp/a.pdf)')
    expect(linkifyPaths('/Volumes/x.xlsx')).toBe('[x.xlsx](/Volumes/x.xlsx)')
  })

  it('links file:// scheme without the scheme', () => {
    expect(linkifyPaths('read file:///tmp/y.md')).toBe('read [y.md](/tmp/y.md)')
  })

  it('does not match right after ( or [ (markdown-link context)', () => {
    const mdLink = '([/Users/me/a.docx](/Users/me/a.docx))'
    expect(linkifyPaths(mdLink)).toBe(mdLink)
    expect(linkifyPaths('[/tmp/b.pdf]')).toBe('[/tmp/b.pdf]')
  })

  it('supports all documented extensions', () => {
    for (const ext of ['docx', 'pdf', 'pptx', 'xlsx', 'doc', 'ppt', 'xls', 'md']) {
      expect(linkifyPaths(`/tmp/f.${ext}`)).toBe(`[f.${ext}](/tmp/f.${ext})`)
    }
  })

  it('leaves plain text and relative paths untouched', () => {
    expect(linkifyPaths('no paths here')).toBe('no paths here')
    expect(linkifyPaths('see ./relative/file.docx')).toBe('see ./relative/file.docx')
  })
})
