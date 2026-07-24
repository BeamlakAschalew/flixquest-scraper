import * as cheerio from 'cheerio'
import type { Provider, ProviderLink, Subtitle } from '../types/index.js'

const BASE_URLS = ['https://dramafull.rest', 'https://dramafull.rest']
const BASE_URL = BASE_URLS[0]
const TMDB_URL = 'https://api.themoviedb.org/3'
const REQUEST_TIMEOUT_MS = 12_000
const HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: `${BASE_URL}/`,
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}

interface TmdbDetails {
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
}

interface SearchItem {
  name?: string
  slug?: string
  themoviedb_id?: number
  baseUrl?: string
}

interface SearchResponse {
  success?: boolean
  data?: SearchItem[]
}

interface VideoResponse {
  success?: boolean
  video_source?: Record<string, string>
  sub?: Record<string, string[]>
}

async function request(url: string): Promise<Response> {
  const target = new URL(url)
  const response = await fetch(url, {
    headers: { ...HEADERS, Referer: `${target.origin}/` },
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

function itemsFromHtml(html: string, baseUrl: string): SearchItem[] {
  const $ = cheerio.load(html)
  const items: SearchItem[] = []
  $('a[href*="/film/"]').each((_index, element) => {
    const anchor = $(element)
    const href = anchor.attr('href')
    if (!href) return
    const url = new URL(href, baseUrl)
    const slug = url.pathname.match(/^\/film\/(.+?)\/?$/)?.[1]
    if (!slug) return
    const name = (
      anchor.attr('title') ||
      anchor.find('.film-name, .film-title, .title, h2, h3').first().text() ||
      anchor.text()
    )
      .replace(/\s+/g, ' ')
      .trim()
    if (name) items.push({ name, slug, baseUrl })
  })
  return Array.from(
    new Map(items.map(item => [`${item.baseUrl}/${item.slug}`, item])).values()
  )
}

async function searchBase(
  baseUrl: string,
  title: string
): Promise<SearchItem[]> {
  try {
    const response = await request(
      `${baseUrl}/api/live-search/${encodeURIComponent(title)}`
    )
    const payload = (await response.json()) as SearchResponse
    if (payload.success && payload.data?.length) {
      return payload.data.map(item => ({ ...item, baseUrl }))
    }
  } catch {
    // The JSON route sometimes fails while normal catalog pages remain live.
  }

  const encoded = encodeURIComponent(title)
  for (const url of [
    `${baseUrl}/search/${encoded}`,
    `${baseUrl}/search?keyword=${encoded}`,
    `${baseUrl}/?s=${encoded}`,
  ]) {
    try {
      const items = itemsFromHtml(await (await request(url)).text(), baseUrl)
      if (items.length) return items
    } catch {
      // Try the next HTML route or mirror.
    }
  }
  return []
}

async function search(title: string): Promise<SearchItem[]> {
  const settled = await Promise.allSettled(
    BASE_URLS.map(baseUrl => searchBase(baseUrl, title))
  )
  return Array.from(
    new Map(
      settled
        .flatMap(result => (result.status === 'fulfilled' ? result.value : []))
        .map(item => [
          `${item.baseUrl || BASE_URL}/${item.slug || item.name}`,
          item,
        ])
    ).values()
  )
}

function findWatchUrl(
  html: string,
  mediaType: 'movie' | 'tv',
  baseUrl: string,
  season = 1,
  episode = 1
): string | undefined {
  const $ = cheerio.load(html)
  let watchUrl: string | undefined
  $(
    '.episode-item a, .film_list-wrap a, a[href*="/wsd/"], a[data-episode]'
  ).each((_index, element) => {
    const anchor = $(element)
    const text = `${anchor.text()} ${anchor.attr('title') || ''} ${
      anchor.attr('data-episode') || ''
    }`
    const seasonMatch = text.match(/season\s*(\d+)/i)
    const episodeMatch =
      text.match(/(?:episode|ep)\s*(\d+)/i) || text.trim().match(/^(\d+)/)
    if (
      episodeMatch &&
      Number(episodeMatch[1]) === episode &&
      (!seasonMatch || Number(seasonMatch[1]) === season)
    ) {
      watchUrl = anchor.attr('href')
      return false
    }
  })
  if (!watchUrl && (mediaType === 'movie' || episode === 1)) {
    watchUrl = $('.btn-play').attr('href') || $('.last-episode a').attr('href')
  }
  return watchUrl ? new URL(watchUrl, baseUrl).href : undefined
}

function subtitlesFrom(payload: VideoResponse, baseUrl: string): Subtitle[] {
  return Object.values(payload.sub || {})
    .flat()
    .flatMap(file =>
      file
        ? [
            {
              file: new URL(file, baseUrl).href,
              label: 'English',
              kind: 'captions',
            },
          ]
        : []
    )
}

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  _season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  try {
    const details = await tmdbDetails(tmdbId, mediaType)
    if (!details.title) return []
    let results = await search(details.title)
    if (!results.length && details.title.includes(':')) {
      results = await search(details.title.split(':')[0].trim())
    }
    const best = results
      .filter(item => item.slug)
      .map(item => ({
        item,
        score:
          (item.themoviedb_id === Number(tmdbId) ? 2 : 0) +
          similarity(details.title, item.name || '') +
          (details.year && item.name?.includes(details.year) ? 0.1 : 0),
      }))
      .sort((left, right) => right.score - left.score)[0]
    if (!best || best.score < 0.45 || !best.item.slug) return []

    const baseUrl = best.item.baseUrl || BASE_URL
    const filmUrl = `${baseUrl}/film/${best.item.slug}`
    const filmHtml = await (await request(filmUrl)).text()
    const watchUrl = findWatchUrl(
      filmHtml,
      mediaType,
      baseUrl,
      _season,
      episode
    )
    if (!watchUrl) return []
    const watchResponse = await request(watchUrl)
    const watchContentType = watchResponse.headers.get('content-type') || ''
    if (/mpegurl|video\//i.test(watchContentType)) {
      return [
        {
          server: 'DramaFull | Original Asian audio | 1',
          url: watchResponse.url,
          isM3U8:
            /mpegurl/i.test(watchContentType) ||
            /\.m3u8(?:$|[?#])/i.test(watchResponse.url),
          quality: 'Auto',
          subtitles: [],
          requiresProxy: true,
          headers: { ...HEADERS, Referer: filmUrl },
        },
      ]
    }
    const watchHtml = await watchResponse.text()
    const signedUrl = watchHtml
      .match(
        /(?:window\.)?signedUrl\s*=\s*["'](.*?)["']|["']signedUrl["']\s*:\s*["'](.*?)["']/i
      )
      ?.slice(1)
      .find(Boolean)
      ?.replace(/\\\//g, '/')
    if (!signedUrl) return []

    const payload = (await (
      await request(new URL(signedUrl, watchUrl).href)
    ).json()) as VideoResponse
    if (!payload.success || !payload.video_source) return []
    const subtitles = subtitlesFrom(payload, baseUrl)
    return Object.entries(payload.video_source).flatMap(
      ([quality, url], index) => {
        if (!/^https?:\/\//i.test(url)) return []
        const normalizedQuality = /^\d+$/.test(quality)
          ? `${quality}p`
          : quality || 'HD'
        return [
          {
            server: `DramaFull | Original Asian audio | EN subs | ${index + 1}`,
            url,
            isM3U8: /\.m3u8(?:$|[?#])/i.test(url),
            quality: normalizedQuality,
            subtitles,
            headers: { ...HEADERS, Referer: watchUrl },
          },
        ]
      }
    )
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
