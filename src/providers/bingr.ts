/**
 * Bingr multi-server resolver (https://bingr.one).
 *
 * Bingr accepts TMDB IDs plus title/year metadata and exposes explicit source
 * quality, language, playback headers, and subtitles. Servers are independent,
 * so failures are isolated and successful results are retained.
 */
import type { Provider, ProviderLink, Subtitle } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'

const API_BASE_URL = 'https://api.bingr.one/api'
const REQUEST_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS
const API_HEADERS = {
  Accept: 'application/json',
  Origin: 'https://bingr.one',
  Referer: 'https://bingr.one/',
}

const SERVERS = [
  { id: 's11', name: 'Sirius' },
  { id: 's40', name: 'DarkMatter' },
  { id: 's12', name: 'Quasar' },
  { id: 's30', name: 'Apollo' },
  { id: 's1', name: 'Miller' },
  { id: 's2', name: 'Mann' },
  { id: 's3', name: 'Edmunds' },
  { id: 's4', name: 'Luna' },
  { id: 's5', name: 'Aditya' },
] as const

interface BingrDetails {
  title: string
  year?: string
}

interface BingrSubtitle {
  url?: string
  file?: string
  label?: string
  lang?: string
  language?: string
}

interface BingrSource {
  url?: string
  file?: string
  quality?: string | number
  language?: string
  lang?: string
  type?: string
  label?: string
  name?: string
  headers?: Record<string, unknown>
  subtitles?: BingrSubtitle[]
}

interface BingrStreamResponse {
  sources?: BingrSource[]
  subtitles?: BingrSubtitle[]
}

function isValidTmdbId(tmdbId: string): boolean {
  return /^\d+$/.test(tmdbId)
}

function isValidEpisodeNumber(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function validHttpUrl(value: string | undefined): URL | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...API_HEADERS, ...init?.headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} from ${new URL(response.url || url).hostname}`
    )
  }
  return (await response.json()) as T
}

function yearFrom(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(value)
  }
  if (typeof value !== 'string') return undefined
  const match = value.match(/\b(19|20)\d{2}\b/)
  return match?.[0]
}

function detailsFrom(root: unknown): BingrDetails {
  if (!root || typeof root !== 'object') return { title: '' }
  const record = root as Record<string, unknown>
  const nested = [record.data, record.details, record.media].find(
    value => value && typeof value === 'object'
  ) as Record<string, unknown> | undefined
  const value = nested || record
  const titleCandidates = [
    value.title,
    value.name,
    value.original_title,
    value.original_name,
  ]
  const title =
    titleCandidates.find(candidate => typeof candidate === 'string') || ''
  const year =
    yearFrom(value.year) ||
    yearFrom(value.release_date) ||
    yearFrom(value.first_air_date)
  return { title: String(title), year }
}

async function getDetails(
  tmdbId: string,
  mediaType: 'movie' | 'tv'
): Promise<BingrDetails> {
  const payload = await requestJson<unknown>(
    `${API_BASE_URL}/details/${mediaType}/${tmdbId}`
  )
  return detailsFrom(payload)
}

function normalizedQuality(value: string | number | undefined): string {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
  if (/2160|4k/.test(raw)) return '2160p'
  const match = raw.match(/(\d{3,4})p?/)
  if (match) return `${match[1]}p`
  if (raw === 'hd') return '720p'
  return 'auto'
}

function normalizedHeaders(
  headers: Record<string, unknown> | undefined
): Record<string, string> | undefined {
  if (!headers) return undefined
  const entries = Object.entries(headers).flatMap(([key, value]) =>
    typeof value === 'string' && key.trim() && value.trim()
      ? [[key, value] as const]
      : []
  )
  return entries.length ? Object.fromEntries(entries) : undefined
}

function subtitlesFrom(entries: BingrSubtitle[] = []): Subtitle[] {
  return Array.from(
    new Map(
      entries.flatMap(entry => {
        const url = validHttpUrl(entry.url || entry.file)
        if (!url) return []
        const subtitle: Subtitle = {
          file: url.href,
          label: entry.label || entry.language || entry.lang || 'Unknown',
          kind: 'captions',
        }
        return [[`${subtitle.file}\n${subtitle.label}`, subtitle] as const]
      })
    ).values()
  )
}

function sourceLink(
  serverName: string,
  source: BingrSource,
  sharedSubtitles: Subtitle[],
  index: number
): ProviderLink | null {
  const url = validHttpUrl(source.url || source.file)
  if (!url) return null
  const type = (source.type || '').toLowerCase()
  const isM3U8 =
    type === 'hls' ||
    type.includes('mpegurl') ||
    /\.m3u8(?:$|[?#])/i.test(url.href)
  const quality = normalizedQuality(source.quality || source.label)
  const language = source.language || source.lang
  const name = source.name || source.label
  const detail = [language, name, quality !== 'auto' ? quality : undefined]
    .filter(Boolean)
    .filter((value, valueIndex, all) => all.indexOf(value) === valueIndex)
    .join(' | ')
  const headers = normalizedHeaders(source.headers)
  const ownSubtitles = subtitlesFrom(source.subtitles)
  const subtitles = Array.from(
    new Map(
      [...sharedSubtitles, ...ownSubtitles].map(
        subtitle => [`${subtitle.file}\n${subtitle.label}`, subtitle] as const
      )
    ).values()
  )
  return {
    server: `Bingr | ${serverName}${detail ? ` | ${detail}` : ` | ${index + 1}`}`,
    url: url.href,
    isM3U8,
    isDASH: type === 'dash' || /\.mpd(?:$|[?#])/i.test(url.href),
    quality,
    subtitles,
    headers,
    requiresProxy: Boolean(headers),
  }
}

async function fetchServer(
  server: (typeof SERVERS)[number],
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  details: BingrDetails,
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  const query: Record<string, string | number> = {}
  if (details.title) query.title = details.title
  if (details.year) query.year = details.year
  if (mediaType === 'tv') {
    query.season = season!
    query.episode = episode!
  }
  const payload = await requestJson<BingrStreamResponse>(
    `${API_BASE_URL}/stream`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        srv: server.id,
        t: mediaType,
        id: tmdbId,
        query,
      }),
    }
  )
  const sharedSubtitles = subtitlesFrom(payload.subtitles)
  return (payload.sources || []).flatMap((source, index) => {
    const link = sourceLink(server.name, source, sharedSubtitles, index)
    return link ? [link] : []
  })
}

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number,
  full = false
): Promise<ProviderLink[]> {
  if (!isValidTmdbId(tmdbId)) return []
  if (
    mediaType === 'tv' &&
    (!isValidEpisodeNumber(season!) || !isValidEpisodeNumber(episode!))
  ) {
    return []
  }
  try {
    const details = await getDetails(tmdbId, mediaType).catch(() => ({
      title: '',
    }))
    if (!full) {
      for (const server of SERVERS) {
        try {
          const links = await fetchServer(
            server,
            tmdbId,
            mediaType,
            details,
            season,
            episode
          )
          if (links.length > 0) {
            const unique = Array.from(
              new Map(links.map(link => [link.url, link] as const)).values()
            )
            console.log(
              `[Bingr] Extracted ${unique.length} candidate stream(s) for ${mediaType} ${tmdbId}`
            )
            return unique
          }
        } catch (error) {
          console.warn(
            `[Bingr] ${server.name} failed: ${error instanceof Error ? error.message : 'Unknown error'}`
          )
        }
      }
      return []
    }

    const results = await Promise.allSettled(
      SERVERS.map(server =>
        fetchServer(server, tmdbId, mediaType, details, season, episode)
      )
    )
    const links = results.flatMap(result =>
      result.status === 'fulfilled' ? result.value : []
    )
    const unique = Array.from(
      new Map(links.map(link => [link.url, link] as const)).values()
    )
    console.log(
      `[Bingr] Extracted ${unique.length} candidate stream(s) for ${mediaType} ${tmdbId}`
    )
    return unique
  } catch (error) {
    console.error(
      `[Bingr] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const bingrProvider: Provider = {
  name: 'Bingr',
  id: 'bingr',
  alias: 'Roha',
  streamMovie: (tmdbId, options) =>
    getStreams(tmdbId, 'movie', undefined, undefined, options?.full),
  streamTV: (tmdbId, season, episode, options) =>
    getStreams(tmdbId, 'tv', season, episode, options?.full),
}
