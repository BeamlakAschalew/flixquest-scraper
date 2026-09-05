import * as cheerio from 'cheerio'
import type { Provider, ProviderLink, Subtitle } from '../types/index.js'

const BASE_URL = 'https://yoturkish.to'
const TMDB_URL = 'https://api.themoviedb.org/3'
const REQUEST_TIMEOUT_MS = 12_000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: `${BASE_URL}/`,
  'User-Agent': USER_AGENT,
}

interface TmdbDetails {
  name?: string
  original_name?: string
  first_air_date?: string
  title?: string
  original_title?: string
  release_date?: string
}

interface SearchResult {
  title: string
  url: string
}

async function request(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    headers: { ...HEADERS, ...options.headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok)
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`)
  return response
}

async function details(tmdbId: string, mediaType: 'movie' | 'tv') {
  const apiKey = process.env.TMDB_API_KEY?.trim()
  if (!apiKey) throw new Error('TMDB_API_KEY is not configured')
  const response = await request(
    `${TMDB_URL}/${mediaType}/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(apiKey)}&language=en-US`
  )
  const data = (await response.json()) as TmdbDetails
  return {
    title: data.name || data.title || '',
    originalTitle: data.original_name || data.original_title || '',
    year: (data.first_air_date || data.release_date || '').slice(0, 4),
  }
}

function normalize(value = ''): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function latinTitle(value: string): string {
  return value
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[şŞ]/g, 's')
    .replace(/[ıİ]/g, 'i')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
}

function similarity(left: string, right: string): number {
  const a = normalize(left)
  const b = normalize(right)
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return 0.9
  const aw = new Set(a.split(' ').filter(word => word.length > 2))
  const bw = new Set(b.split(' ').filter(word => word.length > 2))
  return (
    [...aw].filter(word => bw.has(word)).length / Math.max(aw.size, bw.size)
  )
}

async function search(title: string): Promise<SearchResult[]> {
  const html = await (
    await request(`${BASE_URL}/?s=${encodeURIComponent(title)}`)
  ).text()
  const $ = cheerio.load(html)
  const results: SearchResult[] = []
  $('.item h3 a.title, .item a.poster').each((_index, element) => {
    const anchor = $(element)
    const url = anchor.attr('href')
    const resultTitle = (anchor.attr('title') || anchor.text())
      .replace(/\s+/g, ' ')
      .trim()
    if (url && resultTitle)
      results.push({ title: resultTitle, url: new URL(url, BASE_URL).href })
  })
  return Array.from(new Map(results.map(item => [item.url, item])).values())
}

async function findSeries(
  title: string,
  originalTitle: string
): Promise<string | undefined> {
  const candidates = [] as SearchResult[]
  for (const query of Array.from(
    new Set(
      [
        title,
        originalTitle,
        latinTitle(title),
        latinTitle(originalTitle),
      ].filter(Boolean)
    )
  )) {
    candidates.push(...(await search(query).catch(() => [])))
  }
  return (
    candidates
      .map(item => ({
        item,
        score: Math.max(
          similarity(title, item.title),
          similarity(originalTitle, item.title)
        ),
      }))
      .filter(item => item.score >= 0.45)
      .sort((a, b) => b.score - a.score)[0]?.item.url ||
    BASE_URL +
      '/' +
      latinTitle(title)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') +
      '/'
  )
}

function decodePlayerData(value: string): string {
  const key = [86, 110, 51, 72, 106, 87, 56, 102]
  const bytes = Buffer.from(value.split('|').join(''), 'base64')
  const reversed = Array.from(bytes).reverse()
  return reversed
    .map((byte, index) =>
      String.fromCharCode(((byte - 5 + 256) % 256) ^ key[index % key.length])
    )
    .join('')
}

function unpack(
  source: string,
  radix: number,
  count: number,
  keywords: string[]
): string {
  const encode = (value: number): string => {
    if (radix <= 36) return value.toString(radix)
    const alphabet =
      '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
    let result = ''
    do {
      result = alphabet[value % radix] + result
      value = Math.floor(value / radix)
    } while (value > 0)
    return result
  }
  while (count--) {
    if (keywords[count])
      source = source.replace(
        new RegExp(`\\b${encode(count)}\\b`, 'g'),
        keywords[count]
      )
  }
  return source
}

function unpackScripts(html: string): string {
  let output = html
  const pattern =
    /eval\(function\(p,a,c,k,e,d\)\{while\(c--\).*?\}\('((?:\\.|[^'])*)',\s*(\d+),\s*(\d+),\s*'((?:\\.|[^'])*)'\.split\('\|'\)\)\)/gs
  for (const match of html.matchAll(pattern)) {
    output += `\n${unpack(match[1], Number(match[2]), Number(match[3]), match[4].split('|'))}`
  }
  return output
}

function quality(value: string): string {
  const match = value.match(/\b(2160|1440|1080|720|480|360)p?\b/i)
  return match ? `${match[1]}p` : 'Auto'
}

function mediaUrls(value: string, baseUrl: string): string[] {
  const decoded = value.replace(/\\\//g, '/').replace(/&amp;|&#038;/g, '&')
  return Array.from(
    new Set(
      [
        ...decoded.matchAll(
          /(?:https?:\/\/|\/)[^\s"'\\<>]+\.(?:m3u8|mp4)(?:\?[^\s"'\\<>]*)?/gi
        ),
      ].flatMap(match => {
        try {
          return [new URL(match[0], baseUrl).href]
        } catch {
          return []
        }
      })
    )
  )
}

function subtitles(value: string, baseUrl: string): Subtitle[] {
  return Array.from(
    new Set(
      [
        ...value.matchAll(
          /(?:https?:\/\/|\/)[^\s"'\\<>]+\.(?:vtt|srt)(?:\?[^\s"'\\<>]*)?/gi
        ),
      ].flatMap(match => {
        try {
          return [new URL(match[0], baseUrl).href]
        } catch {
          return []
        }
      })
    )
  ).map((file, index) => ({
    file,
    label: index ? `Subtitle ${index + 1}` : 'English',
    kind: 'captions',
  }))
}

async function episodeUrl(
  seriesUrl: string,
  season: number,
  episode: number
): Promise<string | undefined> {
  const html = await (await request(seriesUrl)).text()
  const $ = cheerio.load(html)
  const episodes: Array<{ url: string; number: number; season: number }> = []
  let currentSeason = 1
  $('.episod').each((_index, element) => {
    const text = $(element).text().replace(/\s+/g, ' ')
    const marker = text.match(/Season\s*(\d+)/i)
    if (marker) currentSeason = Number(marker[1])
    const number = Number(text.match(/Episode\s*(\d+)/i)?.[1])
    const href = $(element).attr('href')
    if (href && number)
      episodes.push({
        url: new URL(href, seriesUrl).href,
        number,
        season: currentSeason,
      })
  })
  return episodes.find(
    item => item.season === season && item.number === episode
  )?.url
}

async function extractEmbed(embedUrl: string): Promise<ProviderLink[]> {
  const html = await (
    await request(embedUrl, { headers: { Referer: `${BASE_URL}/` } })
  ).text()
  const expanded = unpackScripts(html)
  const urls = mediaUrls(expanded, embedUrl)
  const subs = subtitles(expanded, embedUrl)
  return urls.map((url, index) => ({
    server: `YoTurkish | English subtitles | ${new URL(embedUrl).hostname} | ${index + 1}`,
    url,
    isM3U8: /\.m3u8(?:$|[?#])/i.test(url),
    quality: quality(`${url} ${expanded}`),
    subtitles: subs,
    requiresProxy: true,
    headers: { Referer: embedUrl, 'User-Agent': USER_AGENT },
  }))
}

function playerEmbeds(html: string, pageUrl: string): string[] {
  const embeds: string[] = []
  for (const match of html.matchAll(/data-s[1-4]=["']([^"']+)["']/gi)) {
    const iframe = decodePlayerData(match[1]).match(
      /<iframe[^>]+src=["']([^"']+)/i
    )?.[1]
    if (iframe) embeds.push(new URL(iframe, pageUrl).href)
  }
  return Array.from(new Set(embeds))
}

async function stream(
  tmdbId: string,
  season: number,
  episode: number
): Promise<ProviderLink[]> {
  try {
    const info = await details(tmdbId, 'tv')
    const series = await findSeries(info.title, info.originalTitle)
    if (!series) return []
    const page = await episodeUrl(series, season, episode)
    if (!page) return []
    const html = await (await request(page)).text()
    const embeds = playerEmbeds(html, page)
    const settled = await Promise.allSettled(
      embeds.map(url => extractEmbed(url))
    )
    return Array.from(
      new Map(
        settled
          .flatMap(result =>
            result.status === 'fulfilled' ? result.value : []
          )
          .map(link => [link.url, link])
      ).values()
    )
  } catch (error) {
    console.error(
      `[YoTurkish] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const yoTurkishProvider: Provider = {
  name: 'YoTurkish',
  id: 'yoturkish',
  alias: 'Sebastopol',
  streamMovie: async () => [],
  streamTV: (tmdbId, season, episode) => stream(tmdbId, season, episode),
}

export const decodeYoTurkishPlayerData = decodePlayerData
export const unpackYoTurkishScripts = unpackScripts
