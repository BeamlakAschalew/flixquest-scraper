import type { Provider, ProviderLink, Subtitle } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'
import { decodeSeedPayload } from './_shared/seed-cipher.js'

const API_BASE_URL = 'https://api.wecollege.net'
const MOVY_ORIGIN = 'https://www.movy.bz'
const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
const REQUEST_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'

const REQUEST_HEADERS = {
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: MOVY_ORIGIN,
  Referer: `${MOVY_ORIGIN}/`,
  'User-Agent': USER_AGENT,
}

interface MediaDetails {
  title: string
  year: string
  imdbId: string
  totalSeasons: number
}

interface MovySource {
  url?: string
  file?: string
  quality?: string
  label?: string
  title?: string
  type?: string
}

interface MovySubtitle {
  url?: string
  file?: string
  lang?: string
  language?: string
  label?: string
}

interface MovyPayload {
  sources?: MovySource[]
  subtitles?: MovySubtitle[]
  tracks?: MovySubtitle[]
}

function validHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return /^https?:$/.test(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function normalizeQuality(value?: string): string {
  const quality = String(value || '').trim()
  if (/2160|4k|uhd/i.test(quality)) return '2160p'
  if (/1440|2k|qhd/i.test(quality)) return '1440p'
  if (/1080|full\s*hd/i.test(quality)) return '1080p'
  if (/720|\bhd\b/i.test(quality)) return '720p'
  if (/480|\bsd\b/i.test(quality)) return '480p'
  if (/360/i.test(quality)) return '360p'
  return 'Auto'
}

async function fetchMediaDetails(
  tmdbId: string,
  mediaType: 'movie' | 'tv'
): Promise<MediaDetails> {
  const apiKey = process.env.TMDB_API_KEY?.trim()
  if (!apiKey) throw new Error('TMDB_API_KEY is not configured')

  const url = new URL(`${TMDB_BASE_URL}/${mediaType}/${tmdbId}`)
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('append_to_response', 'external_ids')
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`TMDB HTTP ${response.status}`)

  const payload = (await response.json()) as {
    title?: string
    name?: string
    release_date?: string
    first_air_date?: string
    imdb_id?: string
    external_ids?: { imdb_id?: string }
    number_of_seasons?: number
  }
  const title = mediaType === 'movie' ? payload.title : payload.name
  if (!title) throw new Error('TMDB response did not include a title')

  return {
    title,
    year: (payload.release_date || payload.first_air_date || '').slice(0, 4),
    imdbId: payload.imdb_id || payload.external_ids?.imdb_id || '',
    totalSeasons:
      mediaType === 'tv' && Number.isInteger(payload.number_of_seasons)
        ? Math.max(0, payload.number_of_seasons || 0)
        : 0,
  }
}

async function fetchSeed(tmdbId: string): Promise<string> {
  const url = new URL(`${API_BASE_URL}/seed`)
  url.searchParams.set('mediaId', tmdbId)
  const response = await fetch(url, {
    headers: REQUEST_HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Movy seed HTTP ${response.status}`)
  const payload = (await response.json()) as { seed?: string }
  if (!payload.seed) throw new Error('Movy returned an empty seed')
  return payload.seed
}

function formatSubtitles(payload: MovyPayload): Subtitle[] {
  const entries = [...(payload.subtitles || []), ...(payload.tracks || [])]
  return Array.from(
    new Map(
      entries.flatMap(entry => {
        const file = validHttpUrl(entry.url || entry.file)
        if (!file) return []
        const label = entry.language || entry.lang || entry.label || 'Unknown'
        return [
          [
            `${file}\n${label}`,
            { file, label, kind: 'captions' } satisfies Subtitle,
          ] as const,
        ]
      })
    ).values()
  )
}

function formatLinks(payload: MovyPayload): ProviderLink[] {
  const subtitles = formatSubtitles(payload)
  return Array.from(
    new Map(
      (payload.sources || []).flatMap((source, index) => {
        const url = validHttpUrl(source.url || source.file)
        if (!url) return []
        const type = source.type?.toLowerCase() || ''
        const link: ProviderLink = {
          server: `Movy | Miami | ${index + 1}`,
          url,
          isM3U8: type.includes('hls') || /\.m3u8(?:$|[?#])/i.test(url),
          ...(type.includes('dash') || /\.mpd(?:$|[?#])/i.test(url)
            ? { isDASH: true }
            : {}),
          quality: normalizeQuality(
            source.quality || source.label || source.title
          ),
          subtitles,
          headers: REQUEST_HEADERS,
          requiresProxy: true,
        }
        return [[url, link] as const]
      })
    ).values()
  ).sort(
    (left, right) =>
      Number(right.quality.match(/\d{3,4}/)?.[0] || 0) -
      Number(left.quality.match(/\d{3,4}/)?.[0] || 0)
  )
}

async function getMovyStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season = 1,
  episode = 1
): Promise<ProviderLink[]> {
  if (!/^\d+$/.test(tmdbId)) return []
  if (
    mediaType === 'tv' &&
    (!Number.isInteger(season) ||
      season < 1 ||
      !Number.isInteger(episode) ||
      episode < 1)
  ) {
    return []
  }

  try {
    const [details, seed] = await Promise.all([
      fetchMediaDetails(tmdbId, mediaType),
      fetchSeed(tmdbId),
    ])
    const url = new URL(`${API_BASE_URL}/miami/sources`)
    url.searchParams.set('title', encodeURIComponent(details.title))
    url.searchParams.set('mediaType', mediaType)
    url.searchParams.set('year', details.year)
    url.searchParams.set('totalSeasons', String(details.totalSeasons))
    url.searchParams.set('episodeId', String(episode))
    url.searchParams.set('seasonId', String(season))
    url.searchParams.set('tmdbId', tmdbId)
    url.searchParams.set('imdbId', details.imdbId)
    url.searchParams.set('enc', '2')
    url.searchParams.set('seed', seed)

    const response = await fetch(url, {
      headers: REQUEST_HEADERS,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`Miami HTTP ${response.status}`)
    const encrypted = (await response.text()).trim()
    if (!encrypted) throw new Error('Miami returned an empty payload')
    return formatLinks(
      decodeSeedPayload<MovyPayload>(encrypted, seed, Number(tmdbId))
    )
  } catch (error) {
    console.error(
      `[Movy] ${error instanceof Error ? error.message : 'Provider failed'}`
    )
    return []
  }
}

export const movyProvider: Provider = {
  name: 'Movy (Miami)',
  id: 'movy',
  alias: 'Miami',
  streamMovie: tmdbId => getMovyStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getMovyStreams(tmdbId, 'tv', season, episode),
}
