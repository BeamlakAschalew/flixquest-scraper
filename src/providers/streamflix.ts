import type { Provider, ProviderLink } from '../types/index.js'
import { normalizeStreamUrl } from '../utils/stream-validation.js'

const API_BASE = 'https://api.streamflix.app'
const CONFIG_URL = `${API_BASE}/config/config-streamflixapp.json`
const DATA_URL = `${API_BASE}/data.json`
const FIREBASE_URL =
  'wss://chilflix-410be-default-rtdb.asia-southeast1.firebasedatabase.app/.ws?ns=chilflix-410be-default-rtdb&v=5'
const CURRENT_CDN_URL = 'https://stream.streamflixserver.site/'
const CACHE_TTL_MS = 5 * 60 * 1000
const REQUEST_TIMEOUT_MS = 15_000
const WEBSOCKET_TIMEOUT_MS = 30_000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

interface StreamFlixConfig {
  premium?: string[]
  movies?: string[]
  tv?: string[]
  download?: string[]
}

interface StreamFlixItem {
  moviekey?: string
  moviename?: string
  movielink?: string
  movieduration?: string
  movieyear?: string | number
  type?: string
}

interface StreamFlixData {
  data?: StreamFlixItem[]
}

interface EpisodeData {
  key?: string
  link?: string
  name?: string
  runtime?: string | number
}

interface FirebaseMessage {
  t?: string
  d?: {
    r?: number
    b?: {
      s?: string
      d?: Record<string, EpisodeData>
    }
  }
}

interface TmdbResponse {
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
}

let configCache: { value: StreamFlixConfig; timestamp: number } | undefined
let dataCache: { value: StreamFlixData; timestamp: number } | undefined

const playbackHeaders = {
  Referer: `${API_BASE}/`,
  'User-Agent': USER_AGENT,
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`)
  }

  return (await response.json()) as T
}

async function getConfig(): Promise<StreamFlixConfig> {
  if (configCache && Date.now() - configCache.timestamp < CACHE_TTL_MS) {
    return configCache.value
  }

  const value = await getJson<StreamFlixConfig>(CONFIG_URL)
  configCache = { value, timestamp: Date.now() }
  return value
}

async function getData(): Promise<StreamFlixData> {
  if (dataCache && Date.now() - dataCache.timestamp < CACHE_TTL_MS) {
    return dataCache.value
  }

  const value = await getJson<StreamFlixData>(DATA_URL)
  dataCache = { value, timestamp: Date.now() }
  return value
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function similarity(target: string, candidate: string): number {
  const targetWords = normalizeTitle(target).split(/\s+/).filter(Boolean)
  const candidateWords = normalizeTitle(candidate).split(/\s+/).filter(Boolean)
  if (targetWords.length === 0 || candidateWords.length === 0) return 0

  const matches = targetWords.filter(word =>
    candidateWords.some(
      candidateWord =>
        candidateWord === word ||
        (word.length > 3 &&
          (candidateWord.includes(word) || word.includes(candidateWord)))
    )
  ).length

  return matches / Math.max(targetWords.length, candidateWords.length)
}

function findBestMatch(
  title: string,
  year: string,
  mediaType: 'movie' | 'tv',
  items: StreamFlixItem[]
): StreamFlixItem | undefined {
  return items
    .filter(item => item.moviename)
    .map(item => {
      let score = similarity(title, item.moviename || '')
      const itemYear = String(item.movieyear || '').match(/\d{4}/)?.[0]
      if (year && itemYear) score += itemYear === year ? 0.25 : -0.2

      const type = String(item.type || '').toLowerCase()
      if (type) {
        const isTv = /tv|series|show/.test(type)
        score += isTv === (mediaType === 'tv') ? 0.1 : -0.2
      }

      return { item, score }
    })
    .filter(result => result.score >= 0.55)
    .sort((a, b) => b.score - a.score)[0]?.item
}

function createLink(
  url: string,
  quality: string,
  description: string
): ProviderLink | null {
  try {
    const normalizedUrl = normalizeStreamUrl(url)
    return {
      server: `StreamFlix | ${description}`,
      url: normalizedUrl,
      isM3U8: /\.m3u8(?:$|[?#])/i.test(normalizedUrl),
      quality,
      subtitles: [],
      headers: playbackHeaders,
    }
  } catch {
    return null
  }
}

function joinStreamUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function movieLinks(
  item: StreamFlixItem,
  config: StreamFlixConfig
): ProviderLink[] {
  if (!item.movielink) return []

  // Config revisions may rotate movie files across the same download/CDN pools
  // used by TV, so try those hosts after the movie-specific pools.
  const bases = [
    [CURRENT_CDN_URL, '1080p', 'Current CDN'] as const,
    ...(config.premium || []).map(base => [base, '1080p', 'Premium'] as const),
    ...(config.movies || []).map(base => [base, '720p', 'Standard'] as const),
    ...(config.download || []).map(
      base => [base, '720p', 'Download CDN'] as const
    ),
    ...(config.tv || []).map(base => [base, '720p', 'Fallback CDN'] as const),
  ]
  const links = Array.from(
    new Map(bases.map(entry => [entry[0], entry] as const)).values()
  ).map(([base, quality, description]) =>
    createLink(joinStreamUrl(base, item.movielink || ''), quality, description)
  )

  return links.filter((link): link is ProviderLink => link !== null)
}

async function fetchEpisodes(
  movieKey: string,
  targetSeason: number
): Promise<Record<number, EpisodeData>> {
  if (typeof WebSocket === 'undefined') {
    throw new Error('WebSocket is unavailable; Node.js 22 or newer is required')
  }

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(FIREBASE_URL)
    let buffer = ''
    let settled = false

    const finish = (error?: Error, episodes?: Record<number, EpisodeData>) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      try {
        socket.close()
      } catch {
        // The socket may already be closed by Firebase.
      }
      if (error) reject(error)
      else resolve(episodes || {})
    }

    const timeout = setTimeout(
      () => finish(new Error('Firebase episode request timed out')),
      WEBSOCKET_TIMEOUT_MS
    )

    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          t: 'd',
          d: {
            a: 'q',
            r: targetSeason,
            b: {
              p: `Data/${movieKey}/seasons/${targetSeason}/episodes`,
              h: '',
            },
          },
        })
      )
    })

    socket.addEventListener('message', event => {
      const chunk =
        typeof event.data === 'string' ? event.data : String(event.data)
      if (/^\d+$/.test(chunk.trim())) return

      buffer += chunk
      try {
        const message = JSON.parse(buffer) as FirebaseMessage
        buffer = ''
        const body = message.d?.b
        if (body?.d && typeof body.d === 'object') finish(undefined, body.d)
        else if (message.d?.r === targetSeason && body?.s === 'ok') {
          finish(undefined, {})
        }
      } catch {
        if (buffer.length > 1_000_000) {
          finish(new Error('Invalid Firebase episode response'))
        }
      }
    })

    socket.addEventListener('error', () =>
      finish(new Error('Firebase WebSocket request failed'))
    )
    socket.addEventListener('close', () => {
      if (!settled) finish(new Error('Firebase WebSocket closed early'))
    })
  })
}

function findEpisode(
  episodes: Record<number, EpisodeData>,
  episode: number
): EpisodeData | undefined {
  return episodes[episode - 1] || episodes[episode]
}

function fallbackTvLink(
  item: StreamFlixItem,
  config: StreamFlixConfig,
  season: number,
  episode: number
): ProviderLink[] {
  const baseUrl = [
    CURRENT_CDN_URL,
    ...(config.download || []),
    ...(config.tv || []),
    ...(config.premium || []),
  ][0]
  if (!baseUrl || !item.moviekey) return []

  const link = createLink(
    joinStreamUrl(
      baseUrl,
      `tv/${item.moviekey}/s${season}/episode${episode}.mkv`
    ),
    '720p',
    `S${season}E${episode} Fallback`
  )
  return link ? [link] : []
}

async function tvLinks(
  item: StreamFlixItem,
  config: StreamFlixConfig,
  season: number,
  episode: number
): Promise<ProviderLink[]> {
  if (!item.moviekey) return []

  try {
    const episodeData = findEpisode(
      await fetchEpisodes(item.moviekey, season),
      episode
    )
    if (!episodeData?.link) {
      return fallbackTvLink(item, config, season, episode)
    }

    const bases = Array.from(
      new Set([
        CURRENT_CDN_URL,
        ...(config.download || []),
        ...(config.tv || []),
        ...(config.premium || []),
      ])
    )
    return bases
      .map(base =>
        createLink(
          joinStreamUrl(base, episodeData.link || ''),
          '720p',
          `S${season}E${episode}${episodeData.name ? ` | ${episodeData.name}` : ''}`
        )
      )
      .filter((link): link is ProviderLink => link !== null)
  } catch (error) {
    console.warn(
      `[StreamFlix] Episode lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return fallbackTvLink(item, config, season, episode)
  }
}

async function getStreamFlixStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  try {
    const apiKey = process.env.TMDB_API_KEY?.trim()
    if (!apiKey) {
      console.error('[StreamFlix] TMDB_API_KEY is not configured')
      return []
    }

    const [tmdb, data, config] = await Promise.all([
      getJson<TmdbResponse>(
        `https://api.themoviedb.org/3/${mediaType}/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(apiKey)}`
      ),
      getData(),
      getConfig(),
    ])
    const title = tmdb.title || tmdb.name
    const year = (tmdb.release_date || tmdb.first_air_date || '').slice(0, 4)
    if (!title || !Array.isArray(data.data)) return []

    const item = findBestMatch(title, year, mediaType, data.data)
    if (!item) return []

    const links =
      mediaType === 'movie'
        ? movieLinks(item, config)
        : await tvLinks(item, config, season || 1, episode || 1)

    return Array.from(new Map(links.map(link => [link.url, link])).values())
  } catch (error) {
    console.error(
      `[StreamFlix] Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return []
  }
}

export const streamFlixProvider: Provider = {
  name: 'StreamFlix',
  id: 'streamflix',
  alias: 'Begemder',
  streamMovie: tmdbId => getStreamFlixStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreamFlixStreams(tmdbId, 'tv', season, episode),
}
