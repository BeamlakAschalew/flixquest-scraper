import type { ProviderLink, Subtitle } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'

export const RABBIT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
export const RABBIT_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS

export interface GenericSubtitle {
  file?: string
  url?: string
  src?: string
  label?: string
  display?: string
  language?: string
  lang?: string
  kind?: string
  type?: string
}

export interface GenericStream {
  url?: string
  file?: string
  src?: string
  source?: string
  playlist?: string
  quality?: string
  label?: string
  type?: string
  headers?: Record<string, string>
  subtitles?: GenericSubtitle[]
  tracks?: GenericSubtitle[]
  captions?: GenericSubtitle[]
}

export const RABBIT_HEADERS: Record<string, string> = {
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://rabbitmeow.live/',
  'User-Agent': RABBIT_USER_AGENT,
}

export function isValidMediaRequest(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): boolean {
  if (!/^\d+$/.test(tmdbId)) return false
  if (mediaType === 'movie') return true
  return (
    Number.isInteger(season) &&
    Number.isInteger(episode) &&
    (season || 0) > 0 &&
    (episode || 0) > 0
  )
}

export function validHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

export function isMediaUrl(value: string): boolean {
  return /\.(?:m3u8|mpd|mp4|mkv|webm)(?:$|[?#])/i.test(value)
}

export function normalizedQuality(value?: string): string {
  const raw = String(value || '').trim()
  if (/2160|4k|uhd/i.test(raw)) return '2160p'
  if (/1440/i.test(raw)) return '1440p'
  if (/1080|fhd/i.test(raw)) return '1080p'
  if (/720|\bhd\b/i.test(raw)) return '720p'
  if (/480/i.test(raw)) return '480p'
  if (/360/i.test(raw)) return '360p'
  return 'Auto'
}

export function subtitlesFrom(entries: GenericSubtitle[] = []): Subtitle[] {
  return Array.from(
    new Map(
      entries.flatMap(entry => {
        const file = validHttpUrl(entry.file || entry.url || entry.src)
        if (!file) return []
        const label =
          entry.label ||
          entry.display ||
          entry.language ||
          entry.lang ||
          'Unknown'
        const subtitle: Subtitle = {
          file,
          label,
          kind: entry.kind || entry.type || 'captions',
        }
        return [[`${file}\n${label}`, subtitle] as const]
      })
    ).values()
  )
}

export function mergeSubtitles(...groups: Subtitle[][]): Subtitle[] {
  return Array.from(
    new Map(
      groups
        .flat()
        .map(subtitle => [`${subtitle.file}\n${subtitle.label}`, subtitle])
    ).values()
  )
}

export function playbackHeaders(origin: string): Record<string, string> {
  return {
    Accept: '*/*',
    Origin: origin,
    Referer: `${origin}/`,
    'User-Agent': RABBIT_USER_AGENT,
  }
}

export function linkFromUrl(
  source: string,
  server: string,
  value: string,
  quality: string,
  subtitles: Subtitle[],
  headers?: Record<string, string>
): ProviderLink | null {
  const url = validHttpUrl(value)
  if (!url) return null
  const isM3U8 = /\.m3u8(?:$|[?#])/i.test(url)
  const isDASH = /\.mpd(?:$|[?#])/i.test(url)
  return {
    server: `${source} | ${server}`,
    url,
    isM3U8,
    isDASH,
    quality: normalizedQuality(quality),
    subtitles,
    headers,
    requiresProxy: Boolean(headers) || isM3U8 || isDASH,
  }
}

export function deduplicateLinks(links: ProviderLink[]): ProviderLink[] {
  return Array.from(
    new Map(
      links.map(link => [
        link.url,
        { ...link, subtitles: mergeSubtitles(link.subtitles || []) },
      ])
    ).values()
  )
}

export async function fetchJson<T>(
  url: string,
  headers: Record<string, string> = RABBIT_HEADERS
): Promise<T> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(RABBIT_TIMEOUT_MS),
  })
  if (!response.ok)
    throw new Error(
      `HTTP ${response.status} from ${new URL(response.url).host}`
    )
  return (await response.json()) as T
}

export function prefixLinks(
  source: string,
  links: ProviderLink[]
): ProviderLink[] {
  return links.map(link => ({
    ...link,
    server: `${source} | ${link.server}`,
  }))
}
