/**
 * Rive multi-resolver provider (https://rivestream.app).
 *
 * Rive exposes a public provider catalog and resolves each backend
 * independently. Results can include adaptive HLS, explicit-quality HLS/MP4,
 * and subtitles. Partial resolver failures are expected and retained.
 */
import type { Provider, ProviderLink, Subtitle } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'

const API_BASE_URL = 'https://scrapper.rivestream.app/api'
const REQUEST_TIMEOUT_MS = Math.min(DEFAULT_REQUEST_TIMEOUT_MS, 15_000)
const FALLBACK_RESOLVERS = [
  'primevids',
  'flowcast',
  'asiacloud',
  'citadel',
  'hindicast',
  'guru',
  'ophim',
] as const
const API_HEADERS = {
  Accept: 'application/json',
  Origin: 'https://rivestream.app',
  Referer: 'https://rivestream.app/',
}
const PLAYBACK_HEADERS = {
  Origin: 'https://rivestream.app',
  Referer: 'https://rivestream.app/',
}

interface RiveProviderList {
  data?: unknown
}

interface RiveCaption {
  file?: string
  url?: string
  label?: string
  language?: string
}

interface RiveSource {
  url?: string
  file?: string
  quality?: string | number
  source?: string
  name?: string
  format?: string
  type?: string
}

interface RivePayload {
  sources?: RiveSource[]
  captions?: RiveCaption[]
  subtitles?: RiveCaption[]
}

interface RiveResponse {
  data?: RivePayload | null
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

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: API_HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} from ${new URL(response.url || url).hostname}`
    )
  }
  return (await response.json()) as T
}

function normalizedQuality(value: string | number | undefined): string {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
  if (/2160|4k/.test(raw)) return '2160p'
  const match = raw.match(/(\d{3,4})p?/)
  if (match) return `${match[1]}p`
  return 'auto'
}

function subtitlesFrom(entries: RiveCaption[] = []): Subtitle[] {
  return Array.from(
    new Map(
      entries.flatMap(entry => {
        const url = validHttpUrl(entry.file || entry.url)
        if (!url) return []
        const subtitle: Subtitle = {
          file: url.href,
          label: entry.label || entry.language || 'Unknown',
          kind: 'captions',
        }
        return [[`${subtitle.file}\n${subtitle.label}`, subtitle] as const]
      })
    ).values()
  )
}

function providerNamesFrom(payload: RiveProviderList): string[] {
  if (!Array.isArray(payload.data)) return [...FALLBACK_RESOLVERS]
  const names = payload.data.filter(
    (value): value is string =>
      typeof value === 'string' && Boolean(value.trim())
  )
  return names.length
    ? Array.from(new Set(names.map(name => name.trim())))
    : [...FALLBACK_RESOLVERS]
}

async function getResolverNames(): Promise<string[]> {
  try {
    return providerNamesFrom(
      await requestJson<RiveProviderList>(`${API_BASE_URL}/providers`)
    )
  } catch {
    return [...FALLBACK_RESOLVERS]
  }
}

function sourceLink(
  resolver: string,
  source: RiveSource,
  subtitles: Subtitle[],
  index: number
): ProviderLink | null {
  const url = validHttpUrl(source.url || source.file)
  if (!url) return null
  const format = (source.format || source.type || '').toLowerCase()
  const isM3U8 =
    format === 'hls' ||
    format.includes('mpegurl') ||
    /\.m3u8(?:$|[?#])/i.test(url.href)
  const quality = normalizedQuality(source.quality)
  const rawQuality = String(source.quality ?? '').trim()
  const sourceName = source.source || source.name || resolver
  const detail = rawQuality && !/^\d+$/.test(rawQuality) ? rawQuality : quality

  return {
    server: `Rive | ${sourceName}${detail ? ` | ${detail}` : ` | ${index + 1}`}`,
    url: url.href,
    isM3U8,
    isDASH: format === 'dash' || /\.mpd(?:$|[?#])/i.test(url.href),
    quality,
    subtitles,
    headers: PLAYBACK_HEADERS,
    requiresProxy: true,
  }
}

async function fetchResolver(
  resolver: string,
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  const url = new URL(`${API_BASE_URL}/provider`)
  url.searchParams.set('provider', resolver)
  url.searchParams.set('id', tmdbId)
  if (mediaType === 'tv') {
    url.searchParams.set('season', String(season))
    url.searchParams.set('episode', String(episode))
  }

  const payload = await requestJson<RiveResponse>(url.href)
  if (!payload.data) return []
  const subtitles = subtitlesFrom([
    ...(payload.data.captions || []),
    ...(payload.data.subtitles || []),
  ])
  return (payload.data.sources || []).flatMap((source, index) => {
    const link = sourceLink(resolver, source, subtitles, index)
    return link ? [link] : []
  })
}

function mergeSubtitles(links: ProviderLink[]): ProviderLink[] {
  const subtitles = Array.from(
    new Map(
      links.flatMap(link =>
        link.subtitles.map(
          subtitle => [`${subtitle.file}\n${subtitle.label}`, subtitle] as const
        )
      )
    ).values()
  )
  return links.map(link => ({ ...link, subtitles }))
}

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  if (!isValidTmdbId(tmdbId)) return []
  if (
    mediaType === 'tv' &&
    (!isValidEpisodeNumber(season!) || !isValidEpisodeNumber(episode!))
  ) {
    return []
  }

  try {
    const resolvers = await getResolverNames()
    const results = await Promise.allSettled(
      resolvers.map(resolver =>
        fetchResolver(resolver, tmdbId, mediaType, season, episode)
      )
    )
    const links = results.flatMap(result =>
      result.status === 'fulfilled' ? result.value : []
    )
    const unique = Array.from(
      new Map(links.map(link => [link.url, link] as const)).values()
    )
    console.log(
      `[Rive] Extracted ${unique.length} candidate stream(s) for ${mediaType} ${tmdbId}`
    )
    return mergeSubtitles(unique)
  } catch (error) {
    console.error(
      `[Rive] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const riveProvider: Provider = {
  name: 'Rive',
  id: 'rive',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
