import * as cheerio from 'cheerio'
import CryptoJS from 'crypto-js'
import type { Provider, ProviderLink, Subtitle } from '../types/index.js'

const BASE_URL = 'https://dramafull.rest'
const TMDB_URL = 'https://api.themoviedb.org/3'
const REQUEST_TIMEOUT_MS = 12_000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': USER_AGENT,
}

interface TmdbDetails {
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
}

interface SearchItem {
  name: string
  url: string
}

interface MediaCandidate {
  url: string
  referer: string
  subtitles: Subtitle[]
}

async function request(
  url: string,
  referer = `${BASE_URL}/`
): Promise<Response> {
  const response = await fetch(url, {
    headers: { ...HEADERS, Referer: referer },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok)
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`)
  return response
}

async function tmdbDetails(
  tmdbId: string,
  mediaType: 'movie' | 'tv'
): Promise<{ title: string; year: string }> {
  const apiKey = process.env.TMDB_API_KEY?.trim()
  if (!apiKey) throw new Error('TMDB_API_KEY is not configured')
  const response = await fetch(
    `${TMDB_URL}/${mediaType}/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(apiKey)}`,
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
  )
  if (!response.ok) throw new Error(`TMDB HTTP ${response.status}`)
  const data = (await response.json()) as TmdbDetails
  return {
    title: data.name || data.title || '',
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

function similarity(left: string, right: string): number {
  const a = normalize(left)
  const b = normalize(right)
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return 0.9
  const aw = new Set(a.split(' ').filter(word => word.length > 2))
  const bw = new Set(b.split(' ').filter(word => word.length > 2))
  const overlap = [...aw].filter(word => bw.has(word)).length
  return overlap / Math.max(aw.size, bw.size)
}

function searchItems(html: string): SearchItem[] {
  const $ = cheerio.load(html)
  const items: SearchItem[] = []

  // The current WordPress theme keeps actual search results in #list-1.
  // Limiting the selector prevents unrelated "latest" sidebar entries from
  // being mistaken for a title match.
  $('#list-1 ul.items h2 a, #list-1 .item h2 a').each((_index, element) => {
    const anchor = $(element)
    const href = anchor.attr('href')
    const name = (anchor.attr('title') || anchor.text())
      .replace(/\s+/g, ' ')
      .trim()
    if (!href || !name) return
    items.push({ name, url: new URL(href, BASE_URL).href })
  })

  return Array.from(new Map(items.map(item => [item.url, item])).values())
}

async function search(title: string): Promise<SearchItem[]> {
  const response = await request(`${BASE_URL}/?s=${encodeURIComponent(title)}`)
  return searchItems(await response.text())
}

function encode(value: number, radix: number): string {
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

function unpack(
  source: string,
  radix: number,
  count: number,
  keywords: string[]
): string {
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
    /return p\}\('((?:\\.|[^'])*)',\s*(\d+),\s*(\d+),\s*'((?:\\.|[^'])*)'\.split\(/gs
  )) {
    output += `\n${unpack(
      match[1].replace(/\\\//g, '/'),
      Number(match[2]),
      Number(match[3]),
      match[4].split('|')
    )}`
  }
  return output
}

function mediaUrls(value: string, baseUrl: string): string[] {
  const decoded = value
    .replace(/\\\//g, '/')
    .replace(/&amp;|&#038;/g, '&')
    .replace(/\\u0026/g, '&')
  const matches = [
    ...decoded.matchAll(
      /(?:https?:\/\/[^\s"'\\<>]+|\/[^\s"'\\<>]+)\.(?:m3u8|mp4)(?:\?[^\s"'\\<>]*)?/gi
    ),
  ]
  return Array.from(
    new Set(
      matches.flatMap(match => {
        try {
          return [new URL(match[0], baseUrl).href]
        } catch {
          return []
        }
      })
    )
  )
}

function subtitlesFrom(value: string, baseUrl: string): Subtitle[] {
  const decoded = value.replace(/\\\//g, '/')
  const urls = [
    ...decoded.matchAll(
      /(?:https?:\/\/[^\s"'\\<>]+|\/[^\s"'\\<>]+)\.(?:vtt|srt)(?:\?[^\s"'\\<>]*)?/gi
    ),
  ].flatMap(match => {
    try {
      return [new URL(match[0], baseUrl).href]
    } catch {
      return []
    }
  })
  return Array.from(new Set(urls)).map((file, index) => ({
    file,
    label: index === 0 ? 'English' : `Subtitle ${index + 1}`,
    kind: 'captions',
  }))
}

function iframeUrls(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html)
  const urls: string[] = []
  $('iframe').each((_index, element) => {
    const src = $(element).attr('src') || $(element).attr('data-src')
    if (!src) return
    try {
      urls.push(new URL(src, baseUrl).href)
    } catch {
      // Ignore malformed advertisement frames.
    }
  })
  return Array.from(new Set(urls))
}

function joinedNumericStrings(value: string | undefined): string {
  if (!value) return ''
  return [...value.matchAll(/['"](\d+)['"]/g)].map(match => match[1]).join('')
}

function decryptVidBasicPlayer(
  html: string,
  pageUrl: string
): MediaCandidate | undefined {
  const $ = cheerio.load(html)
  const ciphertext = $('script[data-name="crypto"][data-value]')
    .first()
    .attr('data-value')
  if (!ciphertext) return undefined

  const keySource = html.match(/key=CryptoJS([\s\S]{0,500}?),iv=CryptoJS/)?.[1]
  const ivSource = html.match(/,iv=CryptoJS([\s\S]{0,500}?),cryptoData=/)?.[1]
  const keyValue = joinedNumericStrings(keySource)
  const ivValue = joinedNumericStrings(ivSource)
  if (keyValue.length !== 32 || ivValue.length !== 16) return undefined

  try {
    const key = CryptoJS.enc.Utf8.parse(keyValue)
    const iv = CryptoJS.enc.Utf8.parse(ivValue)
    const url = CryptoJS.AES.decrypt(ciphertext, key, { iv }).toString(
      CryptoJS.enc.Utf8
    )
    if (!/^https?:\/\//i.test(url)) return undefined

    const subtitles: Subtitle[] = []
    const encryptedSubtitle = new URL(pageUrl).searchParams.get('sub')
    if (encryptedSubtitle) {
      const file = CryptoJS.AES.decrypt(encryptedSubtitle, key, {
        iv,
      }).toString(CryptoJS.enc.Utf8)
      if (/^https?:\/\//i.test(file)) {
        subtitles.push({ file, label: 'English', kind: 'captions' })
      }
    }

    return { url, referer: pageUrl, subtitles }
  } catch {
    return undefined
  }
}

function episodeUrl(
  html: string,
  detailUrl: string,
  mediaType: 'movie' | 'tv',
  season: number,
  episode: number
): string | undefined {
  const $ = cheerio.load(html)
  const candidates: Array<{
    url: string
    episode?: number
    season?: number
  }> = []

  $('a[href]').each((_index, element) => {
    const anchor = $(element)
    const href = anchor.attr('href')
    if (!href) return
    const value = `${href} ${anchor.text()} ${anchor.attr('title') || ''}`
    const episodeMatch = value.match(/(?:episode|ep)[-_\s]*(\d+)/i)
    if (!episodeMatch) return
    const seasonMatch = value.match(/season[-_\s]*(\d+)/i)
    candidates.push({
      url: new URL(href, detailUrl).href,
      episode: Number(episodeMatch[1]),
      season: seasonMatch ? Number(seasonMatch[1]) : undefined,
    })
  })

  const exact = candidates.find(
    item =>
      item.episode === episode &&
      (item.season === undefined || item.season === season)
  )
  if (exact) return exact.url
  if (mediaType === 'movie') return candidates[0]?.url
  return undefined
}

async function resolveMedia(
  pageUrl: string,
  referer: string,
  visited = new Set<string>(),
  depth = 0
): Promise<MediaCandidate[]> {
  if (visited.has(pageUrl) || depth > 4) return []
  visited.add(pageUrl)

  const response = await request(pageUrl, referer)
  const contentType = response.headers.get('content-type') || ''
  if (/mpegurl|video\//i.test(contentType)) {
    return [
      {
        url: response.url,
        referer,
        subtitles: [],
      },
    ]
  }

  const html = await response.text()
  const decoded = unpackScripts(html)
  const subtitles = subtitlesFrom(decoded, response.url)
  const direct = mediaUrls(decoded, response.url).map(url => ({
    url,
    referer: response.url,
    subtitles,
  }))
  if (direct.length) return direct

  const encryptedPlayer = decryptVidBasicPlayer(html, response.url)
  if (encryptedPlayer) return [encryptedPlayer]

  for (const iframeUrl of iframeUrls(html, response.url)) {
    try {
      const nested = await resolveMedia(
        iframeUrl,
        response.url,
        visited,
        depth + 1
      )
      if (nested.length) return nested
    } catch {
      // Ad and backup frames frequently fail; continue to the next player.
    }
  }
  return []
}

function qualityFromUrl(url: string): string {
  const match = url.match(/\b(2160|1440|1080|720|480|360)p?\b/i)
  return match ? `${match[1]}p` : 'Auto'
}

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season = 1,
  episode = 1
): Promise<ProviderLink[]> {
  try {
    const details = await tmdbDetails(tmdbId, mediaType)
    if (!details.title) return []

    let results = await search(details.title)
    if (!results.length && details.title.includes(':')) {
      results = await search(details.title.split(':')[0].trim())
    }
    const best = results
      .map(item => ({
        item,
        score:
          similarity(details.title, item.name) +
          (details.year && item.name.includes(details.year) ? 0.1 : 0),
      }))
      .sort((left, right) => right.score - left.score)[0]

    if (!best || best.score < 0.65) {
      console.log(`[DramaFull] No catalog match for "${details.title}"`)
      return []
    }

    const detailResponse = await request(best.item.url)
    const detailHtml = await detailResponse.text()
    let pageUrl = detailResponse.url
    if (!iframeUrls(detailHtml, pageUrl).length) {
      const selectedEpisode = episodeUrl(
        detailHtml,
        pageUrl,
        mediaType,
        season,
        episode
      )
      if (!selectedEpisode) {
        console.log(
          `[DramaFull] Episode S${season}E${episode} was not found for "${details.title}"`
        )
        return []
      }
      pageUrl = selectedEpisode
    }

    const candidates = await resolveMedia(pageUrl, best.item.url)
    console.log(
      `[DramaFull] Extracted ${candidates.length} playable candidate(s) for "${details.title}"`
    )
    return Array.from(
      new Map(candidates.map(item => [item.url, item])).values()
    ).map((candidate, index) => ({
      server: `DramaFull | Original Asian audio | ${index + 1}`,
      url: candidate.url,
      isM3U8: /\.m3u8(?:$|[?#])/i.test(candidate.url),
      quality: qualityFromUrl(candidate.url),
      subtitles: candidate.subtitles,
      headers: {
        ...HEADERS,
        Referer: candidate.referer,
      },
      requiresProxy: true,
    }))
  } catch (error) {
    console.error(
      `[DramaFull] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const dramaFullProvider: Provider = {
  name: 'DramaFull',
  id: 'dramafull',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
