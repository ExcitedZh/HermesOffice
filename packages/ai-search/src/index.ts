/**
 * Search utilities (main process) — gsk (Hermes CLI) first, then Serper Google API,
 * with DuckDuckGo as the last resort. The Serper/DuckDuckGo logic mirrors an earlier
 * web_search / google_image_search implementation. Runs in the main process
 * (Node fetch / child process) to avoid renderer CORS; the Serper key reuses SERPER_API_KEY.
 * For gsk auth see ./gsk.ts (`gsk login` or GSK_API_KEY).
 */

import {
  COPYRIGHT_HOSTS,
  asRecord,
  safeHost,
  type ImageSearchResult,
  type WebSearchResult,
} from './shared'
import { gskImageSearch, gskWebSearch, hasGskAuth } from './gsk'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type { ImageSearchResult, WebSearchResult } from './shared'
export * from './gsk'
export * from './hermesoffice-auth'

/**
 * Serper API key: SERPER_API_KEY env var first, then a config-file fallback so
 * the packaged app (double-click launch, no terminal env) can read it too.
 * File: ~/.hermesoffice/serper.json → {"api_key": "..."} (same dir as gsk auth).
 */
function serperConfigPath(): string {
  return join(process.env.HERMESOFFICE_AUTH_DIR || join(homedir(), '.hermesoffice'), 'serper.json')
}

const SERPER_KEY = (): string => {
  if (process.env.SERPER_API_KEY) return process.env.SERPER_API_KEY
  try {
    const configPath = serperConfigPath()
    if (!existsSync(configPath)) return ''
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as { api_key?: string }
    return typeof config.api_key === 'string' && config.api_key ? config.api_key : ''
  } catch {
    return ''
  }
}

// ── Web search ──────────────────────────────────────────────────────

export async function webSearch(
  query: string,
  maxResults = 6,
): Promise<{
  results: WebSearchResult[]
  answer?: string
  method: string
}> {
  if (hasGskAuth()) {
    try {
      const r = await gskWebSearch(query, maxResults)
      if (r.results.length) return { ...r, method: 'gsk' }
    } catch {
      /* fall back to Serper/DuckDuckGo */
    }
  }
  const key = SERPER_KEY()
  if (key) {
    try {
      const resp = await fetchWithTimeout('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: maxResults, gl: 'us', hl: 'en' }),
      })
      if (resp.ok) {
        const data = asRecord(await resp.json())
        const organic: unknown[] = Array.isArray(data.organic) ? data.organic : []
        const results: WebSearchResult[] = organic.slice(0, maxResults).map((item) => {
          const o = asRecord(item)
          return {
            title: String(o.title ?? ''),
            url: String(o.link ?? ''),
            snippet: String(o.snippet ?? ''),
          }
        })
        const answerBox = asRecord(data.answerBox)
        const answerRaw =
          answerBox.answer || answerBox.snippet || asRecord(data.knowledgeGraph).description
        const answer = typeof answerRaw === 'string' && answerRaw ? answerRaw : undefined
        if (results.length) {
          return answer !== undefined
            ? { results, answer, method: 'serper' }
            : { results, method: 'serper' }
        }
      }
    } catch {
      /* fall back to DuckDuckGo */
    }
  }
  return { ...(await duckWebSearch(query, maxResults)), method: 'duckduckgo' }
}

// ── Image search ────────────────────────────────────────────────────

/**
 * Locale hints derived from the query's script, for image-search backends.
 * Matching geo/interface language to the keyword language surfaces the right
 * regional sources (e.g. Chinese keywords → Chinese-image-heavy results);
 * Latin/other queries keep the historical US/English defaults. webSearch is
 * intentionally left on the fixed us/en locale. (exported for tests)
 */
export function searchLocaleFor(query: string): { gl: string; hl: string; ddg: string } {
  // Kana first: Japanese text mixes kanji (Han) with kana, so a Han match alone
  // must not classify a Japanese query as Chinese.
  if (/[\u3040-\u30ff\u31f0-\u31ff]/.test(query)) return { gl: 'jp', hl: 'ja', ddg: 'jp-ja' }
  if (/[\uac00-\ud7af\u1100-\u11ff]/.test(query)) return { gl: 'kr', hl: 'ko', ddg: 'kr-ko' }
  if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(query)) return { gl: 'cn', hl: 'zh-cn', ddg: 'cn-zh' }
  if (/[\u0400-\u04ff]/.test(query)) return { gl: 'ru', hl: 'ru', ddg: 'ru-ru' }
  return { gl: 'us', hl: 'en', ddg: 'us-en' }
}

export async function imageSearch(
  query: string,
  maxResults = 8,
): Promise<{
  images: ImageSearchResult[]
  method: string
}> {
  if (hasGskAuth()) {
    try {
      const images = await gskImageSearch(query, maxResults)
      if (images.length) return { images, method: 'gsk' }
    } catch {
      /* fall back to Serper/DuckDuckGo */
    }
  }
  const key = SERPER_KEY()
  if (key) {
    try {
      const loc = searchLocaleFor(query)
      const resp = await fetchWithTimeout('https://google.serper.dev/images', {
        method: 'POST',
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: Math.min(maxResults, 10), gl: loc.gl, hl: loc.hl }),
      })
      if (resp.ok) {
        const data = asRecord(await resp.json())
        const raw: unknown[] = Array.isArray(data.images) ? data.images : []
        const images: ImageSearchResult[] = []
        for (const item of raw) {
          const img = asRecord(item)
          const imageUrl = String(img.imageUrl ?? img.original ?? '')
          if (!imageUrl) continue
          if (COPYRIGHT_HOSTS.some((d) => imageUrl.toLowerCase().includes(d))) continue
          const entry: ImageSearchResult = {
            title: String(img.title ?? ''),
            imageUrl,
            sourceUrl: String(img.link ?? ''),
            source: String(img.source ?? safeHost(img.link)),
          }
          if (typeof img.imageWidth === 'number') entry.width = img.imageWidth
          if (typeof img.imageHeight === 'number') entry.height = img.imageHeight
          images.push(entry)
          if (images.length >= maxResults) break
        }
        if (images.length) return { images, method: 'serper' }
      }
    } catch {
      /* fall back to DuckDuckGo */
    }
  }
  return { images: await duckImageSearch(query, maxResults), method: 'duckduckgo' }
}

// ── DuckDuckGo fallback (no key / quota exhausted) ──────────────────

async function duckWebSearch(
  query: string,
  maxResults: number,
): Promise<{ results: WebSearchResult[] }> {
  try {
    // DuckDuckGo HTML endpoint (lightweight, no key needed)
    const resp = await fetchWithTimeout(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } },
    )
    const html = await resp.text()
    const results: WebSearchResult[] = []
    const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(html)) !== null && results.length < maxResults) {
      const url = decodeDuckUrl(m[1]!)
      const title = stripTags(m[2]!)
      if (url && title) results.push({ title, url, snippet: '' })
    }
    return { results }
  } catch {
    return { results: [] }
  }
}

async function duckImageSearch(query: string, maxResults: number): Promise<ImageSearchResult[]> {
  try {
    // DuckDuckGo i.js needs a vqd token, so it takes two steps
    const tokenResp = await fetchWithTimeout(
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } },
    )
    const tokenHtml = await tokenResp.text()
    const vqd = /vqd=["']?([\d-]+)["']?/.exec(tokenHtml)?.[1]
    if (!vqd) return []
    const resp = await fetchWithTimeout(
      `https://duckduckgo.com/i.js?l=${searchLocaleFor(query).ddg}&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}`,
      { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://duckduckgo.com/' } },
    )
    const data = asRecord(await resp.json())
    const list: unknown[] = Array.isArray(data.results) ? data.results : []
    const out: ImageSearchResult[] = []
    for (const item of list.slice(0, maxResults)) {
      const img = asRecord(item)
      const imageUrl = String(img.image ?? '')
      if (!imageUrl || COPYRIGHT_HOSTS.some((d) => imageUrl.toLowerCase().includes(d))) continue
      const entry: ImageSearchResult = {
        title: String(img.title ?? ''),
        imageUrl,
        sourceUrl: String(img.url ?? ''),
        source: safeHost(img.url),
      }
      if (typeof img.width === 'number') entry.width = img.width
      if (typeof img.height === 'number') entry.height = img.height
      out.push(entry)
    }
    return out
  } catch {
    return []
  }
}

// ── utils ───────────────────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), init.timeoutMs ?? 15000)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(t)
  }
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .trim()
}

function decodeDuckUrl(href: string): string {
  // DuckDuckGo result links are often /l/?uddg=<encoded>
  const m = /[?&]uddg=([^&]+)/.exec(href)
  if (m) return decodeURIComponent(m[1]!)
  return href.startsWith('http') ? href : ''
}
