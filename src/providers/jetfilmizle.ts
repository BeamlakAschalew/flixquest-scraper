import * as cheerio from 'cheerio'
import type { Provider, ProviderLink } from '../types/index.js'

const BASE_URL = 'https://jetfilmizle.now'
const TMDB_URL = 'https://api.themoviedb.org/3'
const REQUEST_TIMEOUT_MS = 8_000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  Referer: `${BASE_URL}/`,
  'User-Agent': USER_AGENT,
}

interface TmdbDetails {
  title?: string
  name?: string
  original_title?: string
  original_name?: string
  release_date?: string
  first_air_date?: string
}

interface PixelDrainInfo {
  name?: string
  size?: number
}

async function request(
  url: string,
  options: RequestInit = {},
  timeout = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    headers: { ...HEADERS, ...options.headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
  })
  if (!response.ok)
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`)
  return response
}

function titleToSlug(value: string): string {
  return value
    .toLocaleLowerCase('tr')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı|İ/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/â/g, 'a')
    .replace(/û/g, 'u')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function getDetails(tmdbId: string): Promise<{
  titleTr: string
  titleOriginal: string
  year: string
}> {
  const apiKey = process.env.TMDB_API_KEY?.trim()
  if (!apiKey) throw new Error('TMDB_API_KEY is not configured')
  const response = await request(
    `${TMDB_URL}/movie/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(apiKey)}&language=tr-TR`
  )
  const data = (await response.json()) as TmdbDetails
  return {
    titleTr: data.title || '',
    titleOriginal: data.original_title || '',
    year: (data.release_date || '').slice(0, 4),
  }
}

async function getMediaDetails(
  tmdbId: string,
  mediaType: 'movie' | 'tv'
): Promise<{
  titleTr: string
  titleOriginal: string
  year: string
}> {
  if (mediaType === 'movie') return getDetails(tmdbId)
  const apiKey = process.env.TMDB_API_KEY?.trim()
  if (!apiKey) throw new Error('TMDB_API_KEY is not configured')
  const response = await request(
    `${TMDB_URL}/tv/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(apiKey)}&language=tr-TR`
  )
  const data = (await response.json()) as TmdbDetails
  return {
    titleTr: data.name || '',
    titleOriginal: data.original_name || '',
    year: (data.first_air_date || '').slice(0, 4),
  }
}

async function search(title: string): Promise<string[]> {
  const response = await request(
    `${BASE_URL}/arama?q=${encodeURIComponent(title)}`
  )
  const html = await response.text()
  return Array.from(
    new Set(
      [
        ...html.matchAll(
          /href=["'](https?:\/\/jetfilmizle\.[^/]+\/(?:film|dizi)\/[^"'?#]+)/gi
        ),
      ]
        .map(match => match[1])
        .filter((value): value is string => Boolean(value))
    )
  )
}

function looksLikeFilmPage(html: string): boolean {
  return /div#movie|download-btn|film_id|name=["']film_id|pixeldrain/i.test(
    html
  )
}

async function findFilmPage(
  titleTr: string,
  titleOriginal: string,
  mediaType: 'movie' | 'tv' = 'movie'
): Promise<{ url: string; html: string } | undefined> {
  const slugs = Array.from(
    new Set([titleToSlug(titleTr), titleToSlug(titleOriginal)].filter(Boolean))
  )
  const directResults = await Promise.all(
    slugs.map(async slug => {
      const url = `${BASE_URL}/${mediaType === 'movie' ? 'film' : 'dizi'}/${slug}`
      try {
        const html = await (await request(url)).text()
        return looksLikeFilmPage(html) ? { url, html } : undefined
      } catch {
        return undefined
      }
    })
  )
  const direct = directResults.find(Boolean)
  if (direct) return direct

  let links = titleTr ? await search(titleTr).catch(() => []) : []
  if (!links.length && titleOriginal && titleOriginal !== titleTr) {
    links = await search(titleOriginal).catch(() => [])
  }
  const preferred =
    links.find(link => slugs.some(slug => link.includes(`/film/${slug}`))) ||
    links[0]
  if (!preferred) return undefined
  return { url: preferred, html: await (await request(preferred)).text() }
}

function quality(value: string): string {
  if (/2160p|4k/i.test(value)) return '2160p'
  const match = value.match(/\b(1080|720|480|360)p\b/i)
  return match ? `${match[1]}p` : 'Auto'
}

async function pixelDrainLink(
  pageUrl: string,
  index: number
): Promise<ProviderLink | undefined> {
  const fileId = pageUrl.match(/\/u\/([^/?#]+)/)?.[1]
  if (!fileId) return undefined
  const info: PixelDrainInfo = await request(
    `https://pixeldrain.com/api/file/${encodeURIComponent(fileId)}/info`,
    {},
    4_000
  )
    .then(response => response.json() as Promise<PixelDrainInfo>)
    .catch(() => ({}) as PixelDrainInfo)
  const name = info.name || ''
  const size = info.size ? ` | ${Math.round(info.size / 1024 / 1024)} MB` : ''
  return {
    server: `JetFilmizle | Türkçe dublaj | PixelDrain ${index + 1}${size}`,
    url: `https://pixeldrain.com/api/file/${encodeURIComponent(fileId)}?download`,
    isM3U8: false,
    quality: quality(name),
    subtitles: [],
    headers: { Referer: 'https://pixeldrain.com/' },
  }
}

async function resolveJetPlayer(
  iframeUrl: string,
  depth = 0
): Promise<ProviderLink | undefined> {
  if (depth > 3) return undefined
  const url = iframeUrl.startsWith('//') ? `https:${iframeUrl}` : iframeUrl
  const html = await (
    await request(url, { headers: { Referer: `${BASE_URL}/` } })
  ).text()
  const sourceBlock = html.match(/["']?sources["']?\s*:\s*\[\s*\{[^}]+}/i)?.[0]
  const file = sourceBlock?.match(/["']?file["']?\s*:\s*["']([^"']+)/i)?.[1]
  const label = sourceBlock?.match(/["']?label["']?\s*:\s*["']([^"']+)/i)?.[1]
  if (file) {
    return {
      server: 'JetFilmizle | Türkçe dublaj | JetV',
      url: file.replace(/\\\//g, '/'),
      isM3U8: /\.m3u8(?:$|[?#])/i.test(file),
      quality: quality(label || file),
      subtitles: [],
      headers: { Referer: url },
    }
  }
  const nested = html.match(/<iframe[^>]+src=["']([^"']+)/i)?.[1]
  return nested ? resolveJetPlayer(nested, depth + 1) : undefined
}

async function getMovieStreams(tmdbId: string): Promise<ProviderLink[]> {
  try {
    const details = await getMediaDetails(tmdbId, 'movie')
    const page = await findFilmPage(
      details.titleTr,
      details.titleOriginal,
      'movie'
    )
    if (!page) return []
    const pixelDrainUrls = [
      ...page.html.matchAll(
        /(?:href=["']|["'])(?:(https?:)?\/\/)?(pixeldrain\.com\/u\/[^"' <]+)/gi
      ),
    ].map(match => `${match[1] || 'https:'}//${match[2]}`)
    const iframeUrls = [
      ...page.html.matchAll(
        /<iframe[^>]+(?:data-litespeed-src|src)=["']([^"']+)/gi
      ),
    ]
      .map(match => match[1])
      .filter((value): value is string =>
        /jetv\.xyz|d2rs(?:\.com)?/i.test(value)
      )

    const links = await Promise.all([
      ...Array.from(new Set(pixelDrainUrls)).map(pixelDrainLink),
      ...Array.from(new Set(iframeUrls)).map(url =>
        resolveJetPlayer(url).catch(() => undefined)
      ),
    ])
    return Array.from(
      new Map(
        links
          .filter((link): link is ProviderLink => Boolean(link))
          .map(link => [link.url, link])
      ).values()
    )
  } catch (error) {
    console.error(
      `[JetFilmizle] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

function attribute(html: string, name: string): string | undefined {
  return html.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'))?.[1]
}

async function playerResponse(
  pageUrl: string,
  pageHtml: string,
  sourceIndex: string,
  playerType: string
): Promise<string> {
  const filmId = pageHtml.match(/name=["']film_id["']\s+value=["'](\d+)/i)?.[1]
  const csrf = pageHtml.match(
    /name=["']csrf-token["']\s+content=["']([^"']+)/i
  )?.[1]
  if (!filmId || !csrf) throw new Error('JetFilmizle player metadata missing')
  const response = await fetch(`${BASE_URL}/jetplayer`, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      'Accept-Language': HEADERS['Accept-Language'],
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: BASE_URL,
      Referer: pageUrl,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'User-Agent': USER_AGENT,
      'X-CSRF-Token': csrf,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: new URLSearchParams({
      film_id: filmId,
      source_index: sourceIndex,
      player_type: playerType,
      csrf_token: csrf,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok)
    throw new Error(`JetFilmizle player HTTP ${response.status}`)
  return response.text()
}

async function resolveVideoPark(
  iframeUrl: string,
  serverName: string
): Promise<ProviderLink | undefined> {
  const html = await (
    await request(iframeUrl, { headers: { Referer: `${BASE_URL}/` } })
  ).text()
  const streamUrl = html.match(
    /https:\/\/videopark\.[^"' ]+\.workers\.dev\/e\/[^"' <]+/i
  )?.[0]
  if (!streamUrl) return undefined
  const playlist = await (
    await request(streamUrl, { headers: { Referer: iframeUrl } })
  ).text()
  const heights = [...playlist.matchAll(/RESOLUTION=\d+x(\d+)/gi)].map(match =>
    Number(match[1])
  )
  const bestHeight = heights.length ? Math.max(...heights) : 0
  const subtitles = [
    ...html.matchAll(/https?:\/\/[^"' <]+\.vtt(?:\?[^"' <]*)?/gi),
  ].map((match, index) => ({
    file: match[0],
    label: /t__rk|turk/i.test(match[0])
      ? 'tr'
      : /ngiliz|english/i.test(match[0])
        ? 'en'
        : `Subtitle ${index + 1}`,
    kind: 'captions',
  }))
  return {
    server: serverName,
    url: streamUrl,
    isM3U8: true,
    quality: bestHeight ? `${bestHeight}p` : 'Auto',
    subtitles,
    requiresProxy: true,
    headers: { Referer: iframeUrl, 'User-Agent': USER_AGENT },
  }
}

async function getTvStreams(
  tmdbId: string,
  season: number,
  episode: number
): Promise<ProviderLink[]> {
  try {
    const details = await getMediaDetails(tmdbId, 'tv')
    const page = await findFilmPage(
      details.titleTr,
      details.titleOriginal,
      'tv'
    )
    if (!page) return []
    const $ = cheerio.load(page.html)
    const buttons = $(
      `.player-source-btn[data-season="${season}"][data-episode="${episode}"]`
    ).toArray()
    const results = await Promise.allSettled(
      buttons.slice(0, 6).map(async (button, index) => {
        const tag = $.html(button)
        const sourceIndex = attribute(tag, 'data-source-index')
        const playerType = attribute(tag, 'data-player-type') || 'dublaj'
        if (!sourceIndex) return undefined
        const playerHtml = await playerResponse(
          page.url,
          page.html,
          sourceIndex,
          playerType
        )
        const iframe = playerHtml.match(/<iframe[^>]+src=["']([^"']+)/i)?.[1]
        if (!iframe) return undefined
        const iframeUrl = new URL(iframe, BASE_URL).href
        if (/videopark\./i.test(iframeUrl)) {
          return resolveVideoPark(
            iframeUrl,
            `JetFilmizle | Türkçe/English audio | S${season}E${episode} | ${index + 1}`
          )
        }
        return resolveJetPlayer(iframeUrl)
      })
    )
    const links = results.flatMap(result =>
      result.status === 'fulfilled' && result.value ? [result.value] : []
    )
    return Array.from(new Map(links.map(link => [link.url, link])).values())
  } catch (error) {
    console.error(
      `[JetFilmizle] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const jetFilmizleProvider: Provider = {
  name: 'JetFilmizle',
  id: 'jetfilmizle',
  streamMovie: tmdbId => getMovieStreams(tmdbId),
  streamTV: (tmdbId, season, episode) => getTvStreams(tmdbId, season, episode),
}
