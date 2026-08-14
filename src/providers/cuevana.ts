import * as cheerio from 'cheerio'
import type { Provider, ProviderLink } from '../types/index.js'
import { withForcedForwardProxy } from '../utils/forward-proxy.js'

const BASE_URL = 'https://ww1.cuevana3.is'
const TMDB_URL = 'https://api.themoviedb.org/3'
const REQUEST_TIMEOUT_MS = 12_000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.7',
  Referer: `${BASE_URL}/`,
  'User-Agent': USER_AGENT,
}

interface TmdbDetails {
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
}

interface EmbedCandidate {
  url: string
  language: 'Latino' | 'Castellano'
  referer: string
}

async function request(
  url: string,
  headers: Record<string, string> = {}
): Promise<Response> {
  const response = await fetch(url, {
    headers: { ...HEADERS, ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok)
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`)
  return response
}

function unpack(
  source: string,
  radix: number,
  count: number,
  keywords: string[]
): string {
  const encode = (value: number, base: number): string => {
    if (base <= 36) return value.toString(base)
    const alphabet =
      '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
    let result = ''
    do {
      result = alphabet[value % base] + result
      value = Math.floor(value / base)
    } while (value > 0)
    return result
  }
  while (count--) {
    if (!keywords[count]) continue
    source = source.replace(
      new RegExp(`\\b${encode(count, radix)}\\b`, 'g'),
      keywords[count]
    )
  }
  return source
}

function unpackScripts(html: string): string {
  let output = html
  for (const match of html.matchAll(
    /return p\}\('(.*?)',\s*(\d+),\s*(\d+),\s*'(.*?)'\.split\(/gs
  )) {
    output += `\n${unpack(
      match[1],
      Number(match[2]),
      Number(match[3]),
      match[4].split('|')
    )}`
  }
  return output
}

function mediaUrls(value: string): string[] {
  const decoded = value
    .replace(/\\\//g, '/')
    .replace(/&amp;|&#038;/g, '&')
    .replace(/\\u0026/g, '&')
  const urls = [
    ...decoded.matchAll(
      /https?:\/\/[^\s"'\\<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'\\<>]*)?/gi
    ),
  ].map(match => match[0])
  return Array.from(new Set(urls))
}

function quality(value: string): string {
  const match = value.match(/\b(2160|1080|720|480|360)p?\b/i)
  return match ? `${match[1]}p` : 'Auto'
}

async function resolveDood(url: URL, referer: string): Promise<string[]> {
  const embedUrl = new URL(
    `/e/${url.pathname.replace(/\/+$/, '').split('/').at(-1)}`,
    url
  )
  const html = await (await request(embedUrl.href, { Referer: referer })).text()
  if (/Video not found/i.test(html)) return []
  const passPath = html.match(
    /(?:fetch|url)\s*\(\s*["']([^"']*\/pass_md5\/[^"']+)/i
  )?.[1]
  if (!passPath) return mediaUrls(unpackScripts(html))
  const passUrl = new URL(passPath, embedUrl)
  const base = await (
    await request(passUrl.href, { Referer: embedUrl.href })
  ).text()
  if (!/^https?:\/\//i.test(base)) return []
  const random = Array.from({ length: 10 }, () =>
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(
      Math.floor(Math.random() * 62)
    )
  ).join('')
  return [
    `${base}${random}?token=${passUrl.pathname.split('/').at(-1)}&expiry=${Date.now()}`,
  ]
}

async function resolveEmbed(
  candidate: EmbedCandidate
): Promise<ProviderLink[]> {
  let embedUrl = new URL(candidate.url)
  let referer = candidate.referer
  if (embedUrl.hostname.includes('cuevana3')) {
    const playerHtml = await (
      await request(embedUrl.href, { Referer: referer })
    ).text()
    const redirected = playerHtml.match(/\burl\s*=\s*["']([^"']+)/i)?.[1]
    if (!redirected) return []
    referer = embedUrl.href
    embedUrl = new URL(redirected, embedUrl)
  }

  let urls: string[] = []
  if (/dood|do[0-9]go|ds2play/i.test(embedUrl.hostname)) {
    urls = await resolveDood(embedUrl, referer)
  } else {
    const html = await (
      await request(embedUrl.href, { Referer: referer })
    ).text()
    urls = mediaUrls(unpackScripts(html))
  }

  return urls.map((url, index) => ({
    server: `Cuevana | Español ${candidate.language} | ${embedUrl.hostname} | ${index + 1}`,
    url,
    isM3U8: /\.m3u8(?:$|[?#])/i.test(url),
    quality: quality(url),
    subtitles: [],
    requiresProxy: true,
    headers: {
      Referer: embedUrl.href,
      Origin: embedUrl.origin,
      'User-Agent': USER_AGENT,
    },
  }))
}

async function tmdbDetails(
  tmdbId: string,
  mediaType: 'movie' | 'tv'
): Promise<{ title: string; year: string }> {
  const apiKey = process.env.TMDB_API_KEY?.trim()
  if (!apiKey) throw new Error('TMDB_API_KEY is not configured')
  const response = await fetch(
    `${TMDB_URL}/${mediaType}/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(apiKey)}&language=es`,
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
  )
  if (!response.ok) throw new Error(`TMDB HTTP ${response.status}`)
  const data = (await response.json()) as TmdbDetails
  return {
    title: data.title || data.name || '',
    year: (data.release_date || data.first_air_date || '').slice(0, 4),
  }
}

async function findPage(title: string): Promise<string | undefined> {
  const searchUrl = `${BASE_URL}/search/${encodeURIComponent(title)}/`
  const html = await (await request(searchUrl)).text()
  const $ = cheerio.load(html)
  let fallback: string | undefined
  let exact: string | undefined
  $('.TPost .Title').each((_index, element) => {
    const anchor = $(element).closest('a')
    const href = anchor.attr('href')
    if (!href) return
    fallback ||= new URL(href, BASE_URL).href
    if ($(element).text().trim().toLowerCase() === title.toLowerCase()) {
      exact = new URL(href, BASE_URL).href
      return false
    }
  })
  return exact || fallback
}

async function episodePage(
  seriesUrl: string,
  season: number,
  episode: number
): Promise<string | undefined> {
  const html = await (await request(seriesUrl)).text()
  const $ = cheerio.load(html)
  let result: string | undefined
  $('.TPost .Year').each((_index, element) => {
    if ($(element).text().trim() !== `${season}x${episode}`) return
    const href = $(element).closest('a').attr('href')
    if (href) result = new URL(href, BASE_URL).href
    return false
  })
  return result
}

function embedsFromPage(html: string, pageUrl: string): EmbedCandidate[] {
  const $ = cheerio.load(html)
  const embeds: EmbedCandidate[] = []
  $('.open_submenu').each((_index, element) => {
    const text = $(element).text()
    if (!/Español/i.test(text)) return
    const language = /Latino/i.test(text) ? 'Latino' : 'Castellano'
    $('[data-tr], [data-video]', element).each((_childIndex, child) => {
      const url = $(child).attr('data-tr') || $(child).attr('data-video')
      if (url)
        embeds.push({
          url: new URL(url, pageUrl).href,
          language,
          referer: pageUrl,
        })
    })
  })
  return embeds
}

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  try {
    const details = await tmdbDetails(tmdbId, mediaType)
    let pageUrl = await findPage(details.title)
    if (!pageUrl) return []
    if (mediaType === 'tv') {
      pageUrl = await episodePage(pageUrl, season || 1, episode || 1)
      if (!pageUrl) return []
    }
    const html = await (await request(pageUrl)).text()
    const candidates = embedsFromPage(html, pageUrl)
    const settled = await Promise.allSettled(candidates.map(resolveEmbed))
    const links = settled.flatMap(result =>
      result.status === 'fulfilled' ? result.value : []
    )
    return Array.from(new Map(links.map(link => [link.url, link])).values())
  } catch (error) {
    console.error(
      `[Cuevana] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const cuevanaProvider: Provider = {
  name: 'Cuevana',
  id: 'cuevana',
  alias: 'Lasta',
  streamMovie: tmdbId =>
    withForcedForwardProxy(() => getStreams(tmdbId, 'movie')),
  streamTV: (tmdbId, season, episode) =>
    withForcedForwardProxy(() => getStreams(tmdbId, 'tv', season, episode)),
}
