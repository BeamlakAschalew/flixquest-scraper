import type { Provider, ProviderLink } from '../types/index.js'

const DOMAINS_URL =
  'https://raw.githubusercontent.com/wooodyhood/nuvio-repo/main/domains.json'
const FALLBACK_DOMAIN = 'club'
const REQUEST_TIMEOUT_MS = 12_000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

interface TmdbDetails {
  title?: string
  name?: string
  original_title?: string
  original_name?: string
  release_date?: string
  first_air_date?: string
}

interface PurStreamSearchItem {
  id?: string | number
  title?: string
  release_date?: string
}

interface PurStreamMovieSource {
  name?: string
  url?: string
}

interface PurStreamEpisodeSource {
  source_name?: string
  stream_url?: string
  format?: string
}

interface PurStreamResponse {
  data?: {
    items?: {
      movies?: { items?: PurStreamSearchItem[] }
      urls?: PurStreamMovieSource[]
      sources?: PurStreamEpisodeSource[]
    }
  }
}

interface Endpoint {
  api: string
  referer: string
}

async function fetchJson<T>(
  url: string,
  headers: Record<string, string> = {}
): Promise<T> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok)
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`)
  return response.json() as Promise<T>
}

async function endpoint(): Promise<Endpoint> {
  let domain = FALLBACK_DOMAIN
  try {
    const domains = await fetchJson<{ purstream?: string }>(DOMAINS_URL)
    if (domains.purstream) domain = domains.purstream
  } catch {
    // The checked fallback remains useful if the domain registry is offline.
  }
  return {
    api: `https://api.purstream.${domain}/api/v1`,
    referer: `https://purstream.${domain}/`,
  }
}

async function metadata(
  tmdbId: string,
  mediaType: 'movie' | 'tv'
): Promise<{ french: string; original: string; year?: number }> {
  const apiKey = process.env.TMDB_API_KEY?.trim()
  if (!apiKey) throw new Error('TMDB_API_KEY is not configured')
  const url = new URL(
    `https://api.themoviedb.org/3/${mediaType}/${encodeURIComponent(tmdbId)}`
  )
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('language', 'fr-FR')
  const details = await fetchJson<TmdbDetails>(url.href)
  const french = mediaType === 'tv' ? details.name : details.title
  const original =
    mediaType === 'tv' ? details.original_name : details.original_title
  const date =
    mediaType === 'tv' ? details.first_air_date : details.release_date
  if (!french && !original) throw new Error('TMDB returned no title')
  return {
    french: french || original || '',
    original: original || french || '',
    year: date ? Number(date.slice(0, 4)) : undefined,
  }
}

function normalizeTitle(value = ''): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function searchId(
  target: Endpoint,
  title: string,
  year?: number
): Promise<string> {
  const response = await fetchJson<PurStreamResponse>(
    `${target.api}/search-bar/search/${encodeURIComponent(title)}`,
    { 'User-Agent': USER_AGENT, Referer: target.referer }
  )
  const items = response.data?.items?.movies?.items || []
  if (!items.length) throw new Error(`PurStream found no match for ${title}`)
  const normalized = normalizeTitle(title)
  const match =
    items.find(item => {
      const itemYear = Number(item.release_date?.match(/\d{4}/)?.[0])
      return (
        normalizeTitle(item.title) === normalized &&
        (!year || !itemYear || Math.abs(year - itemYear) <= 1)
      )
    }) || items[0]
  if (match.id === undefined) throw new Error('PurStream match has no ID')
  return match.id.toString()
}

function quality(label = ''): string {
  const match = label.toLowerCase().match(/2160|4k|1080|720|480|360/)
  if (!match) return 'HD'
  if (match[0] === '4k' || match[0] === '2160') return '2160p'
  return `${match[0]}p`
}

function movieLinks(
  sources: PurStreamMovieSource[],
  target: Endpoint
): ProviderLink[] {
  return sources.flatMap((source, index) => {
    if (!source.url || !/^https?:\/\//i.test(source.url)) return []
    if (!/\.(?:m3u8|mp4)(?:$|[?#])/i.test(source.url)) return []
    return [
      {
        server: `purstream-${index + 1}`,
        url: source.url,
        isM3U8: /\.m3u8(?:$|[?#])/i.test(source.url),
        quality: quality(source.name),
        subtitles: [],
        headers: { 'User-Agent': USER_AGENT, Referer: target.referer },
        requiresProxy: true,
      },
    ]
  })
}

function episodeLinks(
  sources: PurStreamEpisodeSource[],
  target: Endpoint
): ProviderLink[] {
  return sources.flatMap((source, index) => {
    if (!source.stream_url || !/^https?:\/\//i.test(source.stream_url))
      return []
    return [
      {
        server: `purstream-${index + 1}`,
        url: source.stream_url,
        isM3U8:
          source.format?.toLowerCase() === 'm3u8' ||
          /\.m3u8(?:$|[?#])/i.test(source.stream_url),
        quality: quality(source.source_name),
        subtitles: [],
        headers: { 'User-Agent': USER_AGENT, Referer: target.referer },
        requiresProxy: true,
      },
    ]
  })
}

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  try {
    const [target, info] = await Promise.all([
      endpoint(),
      metadata(tmdbId, mediaType),
    ])
    let id: string
    try {
      id = await searchId(target, info.french, info.year)
    } catch {
      id = await searchId(target, info.original, info.year)
    }
    const headers = { 'User-Agent': USER_AGENT, Referer: target.referer }
    const payload =
      mediaType === 'tv'
        ? await fetchJson<PurStreamResponse>(
            `${target.api}/stream/${id}/episode?season=${season || 1}&episode=${episode || 1}`,
            headers
          )
        : await fetchJson<PurStreamResponse>(
            `${target.api}/media/${id}/sheet`,
            headers
          )
    const links =
      mediaType === 'tv'
        ? episodeLinks(payload.data?.items?.sources || [], target)
        : movieLinks(payload.data?.items?.urls || [], target)
    console.log(`[PurStream] Extracted ${links.length} candidate stream(s)`)
    return links
  } catch (error) {
    console.error(
      `[PurStream] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const purStreamProvider: Provider = {
  name: 'PurStream',
  id: 'purstream',
  alias: 'Debre Damo',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
