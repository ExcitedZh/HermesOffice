import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { webSearch, imageSearch, searchLocaleFor } from '../src/index'

// These cases only test the Serper/DuckDuckGo paths; a local gsk login would take priority, so disable it explicitly
beforeAll(() => {
  process.env.AI_SEARCH_DISABLE_GSK = '1'
})

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env.SERPER_API_KEY
})

function mockFetch(
  handler: (url: string, init?: RequestInit) => { ok: boolean; json?: any; text?: string },
) {
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    const r = handler(String(url), init)
    return {
      ok: r.ok,
      status: r.ok ? 200 : 500,
      headers: new Map(),
      json: async () => r.json,
      text: async () => r.text ?? '',
    } as any
  }) as any
}

describe('webSearch (Serper)', () => {
  it('parses organic results + answer box', async () => {
    process.env.SERPER_API_KEY = 'test-key'
    mockFetch((url) => {
      expect(url).toBe('https://google.serper.dev/search')
      return {
        ok: true,
        json: {
          answerBox: { answer: '42' },
          organic: [
            { title: 'A', link: 'https://a.com', snippet: 'sa' },
            { title: 'B', link: 'https://b.com', snippet: 'sb' },
          ],
        },
      }
    })
    const r = await webSearch('meaning of life', 5)
    expect(r.method).toBe('serper')
    expect(r.answer).toBe('42')
    expect(r.results).toHaveLength(2)
    expect(r.results[0]).toEqual({ title: 'A', url: 'https://a.com', snippet: 'sa' })
  })

  it('falls back to DuckDuckGo when no key', async () => {
    mockFetch((url) => {
      expect(url).toContain('duckduckgo.com')
      return {
        ok: true,
        text: '<a class="result__a" href="/l/?uddg=https%3A%2F%2Fx.com">X Title</a>',
      }
    })
    const r = await webSearch('q', 3)
    expect(r.method).toBe('duckduckgo')
    expect(r.results[0]?.url).toBe('https://x.com')
    expect(r.results[0]?.title).toBe('X Title')
  })
})

describe('imageSearch (Serper)', () => {
  it('parses images + filters copyright hosts', async () => {
    process.env.SERPER_API_KEY = 'test-key'
    mockFetch((url) => {
      expect(url).toBe('https://google.serper.dev/images')
      return {
        ok: true,
        json: {
          images: [
            {
              title: 'good',
              imageUrl: 'https://cdn.example.com/a.jpg',
              link: 'https://example.com',
              imageWidth: 800,
              imageHeight: 600,
            },
            {
              title: 'paid',
              imageUrl: 'https://gettyimages.com/x.jpg',
              link: 'https://gettyimages.com',
            },
          ],
        },
      }
    })
    const r = await imageSearch('cats', 8)
    expect(r.method).toBe('serper')
    expect(r.images).toHaveLength(1) // getty is filtered out
    expect(r.images[0]).toMatchObject({
      imageUrl: 'https://cdn.example.com/a.jpg',
      width: 800,
      height: 600,
    })
  })

  it('Chinese query sends cn/zh-cn locale to Serper; Latin query keeps us/en', async () => {
    process.env.SERPER_API_KEY = 'test-key'
    const bodies: Record<string, unknown>[] = []
    mockFetch((_url, init) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')))
      return { ok: true, json: { images: [{ imageUrl: 'https://cdn.example.com/a.jpg' }] } }
    })
    await imageSearch('颐和园昆明湖', 8)
    await imageSearch('summer palace lake', 8)
    expect(bodies[0]).toMatchObject({ gl: 'cn', hl: 'zh-cn' })
    expect(bodies[1]).toMatchObject({ gl: 'us', hl: 'en' })
  })
})

describe('imageSearch (DuckDuckGo fallback)', () => {
  it('region parameter follows the query language (Chinese → cn-zh)', async () => {
    let ddgUrl = ''
    mockFetch((url) => {
      const u = String(url)
      if (u.includes('/i.js')) {
        ddgUrl = u
        return {
          ok: true,
          json: {
            results: [{ image: 'https://cdn.example.com/a.jpg', url: 'https://example.com' }],
          },
        }
      }
      return { ok: true, text: '<html>vqd="4-126"</html>' }
    })
    const r = await imageSearch('颐和园昆明湖', 8)
    expect(r.method).toBe('duckduckgo')
    expect(ddgUrl).toContain('l=cn-zh')
    expect(ddgUrl).toContain(encodeURIComponent('颐和园昆明湖'))
  })
})

describe('searchLocaleFor', () => {
  it('maps query scripts to search locales', () => {
    expect(searchLocaleFor('summer palace kunming lake')).toEqual({
      gl: 'us',
      hl: 'en',
      ddg: 'us-en',
    })
    expect(searchLocaleFor('颐和园昆明湖')).toEqual({ gl: 'cn', hl: 'zh-cn', ddg: 'cn-zh' })
    // Japanese mixes kanji with kana — kana must win over the Han check
    expect(searchLocaleFor('京都の桜')).toEqual({ gl: 'jp', hl: 'ja', ddg: 'jp-ja' })
    expect(searchLocaleFor('경복궁 야경')).toEqual({ gl: 'kr', hl: 'ko', ddg: 'kr-ko' })
    expect(searchLocaleFor('Московский кремль')).toEqual({ gl: 'ru', hl: 'ru', ddg: 'ru-ru' })
  })
})
