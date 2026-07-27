import * as cheerio from 'cheerio'
import * as http2 from 'node:http2'
import type { Provider, ProviderLink } from '../types/index.js'

const BASE_URL =
  process.env.BOLLYFLIX_BASE_URL?.trim().replace(/\/+$/, '') ||
  'https://bollyflix.at'
const TMDB_URL = 'https://api.themoviedb.org/3'
const REQUEST_TIMEOUT_MS = 15_000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const PAGE_HEADERS = {
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

interface DownloadOption {
  url: string
  label: string
  quality: string
}

interface HtmlResponse {
  url: string
  status: number
  html: string
}

async function request(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: { ...PAGE_HEADERS, ...options.headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

async function getDetails(
  tmdbId: string,
  mediaType: 'movie' | 'tv'
): Promise<{ title: string; year: string }> {
  const apiKey = process.env.TMDB_API_KEY?.trim()
  if (!apiKey) throw new Error('TMDB_API_KEY is not configured')
  const response = await request(
    `${TMDB_URL}/${mediaType}/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(apiKey)}`,
    { headers: { Accept: 'application/json' } }
  )
  if (!response.ok) throw new Error(`TMDB HTTP ${response.status}`)
  const details = (await response.json()) as TmdbDetails
  return {
    title: details.title || details.name || '',
    year: (details.release_date || details.first_air_date || '').slice(0, 4),
  }
}

function normalize(value = ''): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\bdownload\b/g, '')
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

function qualityFrom(value: string): string {
  const match = value.match(/\b(2160|1080|720|480|360)p?\b/i)
  return match ? `${match[1]}p` : 'Auto'
}

async function search(title: string): Promise<SearchItem[]> {
  const response = await request(
    `${BASE_URL}/?s=${encodeURIComponent(title)}`,
    {
      redirect: 'follow',
      headers: { Referer: `${BASE_URL}/` },
    }
  )
  if (!response.ok) throw new Error(`Catalog search HTTP ${response.status}`)
  const $ = cheerio.load(await response.text())
  const items: SearchItem[] = []
  $('.post-cards article.latestPost h2 a').each((_index, element) => {
    const anchor = $(element)
    const href = anchor.attr('href')
    const name = (anchor.attr('title') || anchor.text())
      .replace(/\s+/g, ' ')
      .trim()
    if (!href || !name) return
    items.push({ name, url: new URL(href, response.url).href })
  })
  return Array.from(new Map(items.map(item => [item.url, item])).values())
}

function nearestHeading(
  $: cheerio.CheerioAPI,
  anchor: cheerio.Cheerio<cheerio.Element>
): string {
  const heading = anchor
    .parent()
    .prevAll('h1, h2, h3, h4, h5, h6')
    .first()
    .text()
  if (heading.trim()) return heading.replace(/\s+/g, ' ').trim()

  return anchor
    .closest('div, section, article')
    .find('h1, h2, h3, h4, h5, h6')
    .first()
    .text()
    .replace(/\s+/g, ' ')
    .trim()
}

function downloadOptions(
  html: string,
  pageUrl: string,
  mediaType: 'movie' | 'tv',
  season: number
): DownloadOption[] {
  const $ = cheerio.load(html)
  const options: DownloadOption[] = []
  $('a[href]').each((_index, element) => {
    const anchor = $(element)
    const href = anchor.attr('href')
    if (!href) return
    let url: URL
    try {
      url = new URL(href, pageUrl)
    } catch {
      return
    }

    const movieLink = url.hostname === 'dl.fastdlserver.site'
    const seriesLink = url.hostname === 'fxlinks.rest'
    if (
      (mediaType === 'movie' && !movieLink) ||
      (mediaType === 'tv' && !seriesLink)
    )
      return

    const label = nearestHeading($, anchor)
    if (mediaType === 'tv') {
      const seasonMatch =
        label.match(/\bseason\s*0*(\d+)\b/i) || label.match(/\bS0*(\d+)\b/i)
      if (!seasonMatch || Number(seasonMatch[1]) !== season) return
    }
    options.push({ url: url.href, label, quality: qualityFrom(label) })
  })
  return Array.from(
    new Map(options.map(option => [option.url, option])).values()
  )
}

async function episodeLink(
  option: DownloadOption,
  episode: number
): Promise<string | undefined> {
  const response = await request(option.url, {
    redirect: 'follow',
    headers: { Referer: BASE_URL },
  })
  if (!response.ok) return undefined
  const $ = cheerio.load(await response.text())
  let selected: string | undefined
  $('a[href]').each((_index, element) => {
    const anchor = $(element)
    const text = anchor.text().replace(/\s+/g, ' ').trim()
    const match = text.match(/\bepisode\s*0*(\d+)\b/i)
    if (!match || Number(match[1]) !== episode) return
    const href = anchor.attr('href')
    if (!href) return
    const url = new URL(href, response.url)
    if (url.hostname !== 'dl.fastdlserver.site') return
    selected = url.href
    return false
  })
  return selected
}

function gdflixCookie(): string | undefined {
  const value = process.env.BOLLYFLIX_GDFLIX_COOKIE?.trim()
  return value || undefined
}

async function requestHttp2Html(
  url: string,
  redirects = 0
): Promise<HtmlResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const client = http2.connect(target.origin)
    let settled = false
    let status = 0
    let location: string | undefined
    let html = ''

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      client.destroy()
      reject(error)
    }
    client.once('error', fail)

    const cookie = gdflixCookie()
    const stream = client.request({
      ':method': 'GET',
      ':path': `${target.pathname}${target.search}`,
      Accept: PAGE_HEADERS.Accept,
      'Accept-Language': PAGE_HEADERS['Accept-Language'],
      'User-Agent': USER_AGENT,
      Referer: BASE_URL,
      ...(cookie ? { Cookie: cookie } : {}),
    })
    stream.setEncoding('utf8')
    stream.once('response', headers => {
      status = Number(headers[':status'] || 0)
      location =
        typeof headers.location === 'string' ? headers.location : undefined
    })
    stream.on('data', chunk => {
      if (html.length < 2_000_000) html += chunk
    })
    stream.setTimeout(REQUEST_TIMEOUT_MS, () => {
      fail(new Error(`HTTP/2 timeout from ${target.hostname}`))
    })
    stream.once('error', fail)
    stream.once('end', () => {
      if (settled) return
      settled = true
      client.close()
      if (status >= 300 && status < 400 && location && redirects < 5) {
        requestHttp2Html(new URL(location, target).href, redirects + 1).then(
          resolve,
          reject
        )
        return
      }
      resolve({ url: target.href, status, html })
    })
    stream.end()
  })
}

function directMediaUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (
      /(?:^|\.)googleusercontent\.com$/i.test(url.hostname) ||
      /(?:^|\.)googleapis\.com$/i.test(url.hostname)
    )
      return url.href
    if (url.hostname === 'fastcdn-dl.pages.dev') {
      const nested = url.searchParams.get('url')
      return nested ? directMediaUrl(nested) : undefined
    }
  } catch {
    // Ignore malformed redirect URLs.
  }
  return undefined
}

async function resolveInstant(url: string): Promise<string | undefined> {
  const response = await request(url, {
    redirect: 'manual',
    headers: { Range: 'bytes=0-1023', Referer: 'https://gdflix.dev/' },
  })
  const location = response.headers.get('location')
  if (location) {
    await response.body?.cancel()
    return directMediaUrl(new URL(location, url).href)
  }

  if (
    response.ok &&
    /text\/html/i.test(response.headers.get('content-type') || '')
  ) {
    const html = await response.text()
    const nested = html.match(
      /https?:\/\/(?:video-downloads\.)?googleusercontent\.com\/[^"'<>\s]+/i
    )?.[0]
    return nested?.replace(/&amp;/g, '&')
  }
  return undefined
}

async function resolveFastDl(url: string): Promise<string | undefined> {
  const redirect = await request(url, {
    redirect: 'manual',
    headers: { Referer: BASE_URL },
  })
  const location = redirect.headers.get('location')
  await redirect.body?.cancel()
  if (!location) return undefined

  const gdflixUrl = new URL(location, url)
  if (!/(?:^|\.)gdflix\.(?:dev|io|net|dad|cfd)$/i.test(gdflixUrl.hostname))
    return directMediaUrl(gdflixUrl.href)

  const page = await requestHttp2Html(gdflixUrl.href)
  const html = page.html
  if (page.status === 403 || /Just a moment|cf-chl/i.test(html)) {
    console.log('[BollyFlix] GdFlix requires a current BOLLYFLIX_GDFLIX_COOKIE')
    return undefined
  }

  const $ = cheerio.load(html)
  const instantUrls: string[] = []
  $('a[href]').each((_index, element) => {
    const href = $(element).attr('href')
    if (!href) return
    const resolved = new URL(href, page.url)
    const direct = directMediaUrl(resolved.href)
    if (direct) instantUrls.push(direct)
    else if (resolved.hostname === 'instant.busycdn.xyz')
      instantUrls.push(resolved.href)
  })

  for (const candidate of instantUrls) {
    const direct = directMediaUrl(candidate)
    if (direct) return direct
    try {
      const resolved = await resolveInstant(candidate)
      if (resolved) return resolved
    } catch {
      // Try another download mirror exposed by GdFlix.
    }
  }
  return undefined
}

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season = 1,
  episode = 1
): Promise<ProviderLink[]> {
  try {
    const details = await getDetails(tmdbId, mediaType)
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
          (details.year && item.name.includes(details.year) ? 0.15 : 0),
      }))
      .sort((left, right) => right.score - left.score)[0]

    if (!best || best.score < 0.7) {
      console.log(`[BollyFlix] No catalog match for "${details.title}"`)
      return []
    }

    const detailResponse = await request(best.item.url, {
      redirect: 'follow',
      headers: { Referer: `${BASE_URL}/` },
    })
    if (!detailResponse.ok)
      throw new Error(`Detail page HTTP ${detailResponse.status}`)
    const options = downloadOptions(
      await detailResponse.text(),
      detailResponse.url,
      mediaType,
      season
    )

    const links: ProviderLink[] = []
    for (const [index, option] of options.entries()) {
      const fastDlUrl =
        mediaType === 'tv' ? await episodeLink(option, episode) : option.url
      if (!fastDlUrl) continue
      const directUrl = await resolveFastDl(fastDlUrl)
      if (!directUrl) continue
      links.push({
        server: `BollyFlix | ${option.label || `Server ${index + 1}`}`,
        url: directUrl,
        isM3U8: false,
        quality: option.quality,
        subtitles: [],
        requiresProxy: true,
        headers: { 'User-Agent': USER_AGENT },
      })
    }
    console.log(
      `[BollyFlix] Resolved ${links.length}/${options.length} current catalog option(s)`
    )
    return links
  } catch (error) {
    console.error(
      `[BollyFlix] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const bollyFlixProvider: Provider = {
  name: 'BollyFlix',
  id: 'bollyflix',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
