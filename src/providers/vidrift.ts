/**
 * VidRift resolver used by 7Movies (https://7movies.in).
 *
 * Only the independent Earth resolver is queried. 7Movies' other fallback
 * servers overlap providers already available in this project. Earth returns
 * adaptive HLS masters on rotating, title-specific media roots.
 */
import type { Provider, ProviderLink, Subtitle } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'

const SITE_URL = 'https://7movies.in'
const EMBED_URL = 'https://embed.animecurx.tech'
const REQUEST_TIMEOUT_MS = Math.min(DEFAULT_REQUEST_TIMEOUT_MS, 30_000)
const API_HEADERS = {
  Accept: 'application/json',
  Origin: SITE_URL,
  Referer: `${SITE_URL}/`,
}

interface PlaybackTokenResponse {
  token?: string
}

interface VidRiftStream {
  url?: string
  proxyUrl?: string
  type?: string
}

interface VidRiftSourceResponse {
  streams?: VidRiftStream[]
}

interface HlsVariant {
  url: string
  quality: string
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
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`)
  }
  return (await response.json()) as T
}

async function getPlaybackToken(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<string> {
  const payload = await requestJson<PlaybackTokenResponse>(
    `${SITE_URL}/api/playback-token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tmdbId: Number(tmdbId),
        type: mediaType,
        season: mediaType === 'tv' ? season : 0,
        episode: mediaType === 'tv' ? episode : 0,
      }),
    }
  )
  if (!payload.token) throw new Error('VidRift returned no playback token')
  return payload.token
}

async function resolveSource(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<VidRiftSourceResponse> {
  let lastError: unknown

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const token = await getPlaybackToken(tmdbId, mediaType, season, episode)
      const path =
        mediaType === 'tv'
          ? `tv/${tmdbId}/${season}/${episode}`
          : `movie/${tmdbId}`
      const url = new URL(`${EMBED_URL}/api/source/${path}`)
      url.searchParams.set('token', token)
      url.searchParams.set('provider', 'vaplayer')
      return await requestJson<VidRiftSourceResponse>(url.href)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('VidRift source resolution failed')
}

function directStreamUrl(stream: VidRiftStream): URL | null {
  const direct = validHttpUrl(stream.url)
  if (direct) return direct
  if (!stream.proxyUrl) return null

  try {
    const proxy = new URL(stream.proxyUrl, EMBED_URL)
    return validHttpUrl(proxy.searchParams.get('url') || undefined)
  } catch {
    return null
  }
}

function qualityFromResolution(width: number, height: number): string {
  if (width >= 3800 || height >= 1600) return '2160p'
  if (width >= 1900 || height >= 1000) return '1080p'
  if (width >= 1200 || height >= 650) return '720p'
  if (width >= 800 || height >= 430) return '480p'
  if (width >= 600 || height >= 300) return '360p'
  return height > 0 ? `${height}p` : 'auto'
}

function hlsAttribute(line: string, name: string): string | undefined {
  const match = line.match(
    new RegExp(
      `(?:^|,)\\s*${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^,\\r\\n]*))`,
      'i'
    )
  )
  return (match?.[1] ?? match?.[2] ?? match?.[3])?.trim()
}

function parseManifest(
  manifest: string,
  masterUrl: string
): {
  variants: HlsVariant[]
  subtitles: Subtitle[]
} {
  const lines = manifest.split(/\r?\n/)
  const variants: HlsVariant[] = []
  const subtitles: Subtitle[] = []

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim()
    if (line.startsWith('#EXT-X-MEDIA:') && /TYPE=SUBTITLES/i.test(line)) {
      const uri = hlsAttribute(line, 'URI')
      if (!uri) continue
      subtitles.push({
        file: new URL(uri, masterUrl).href,
        label:
          hlsAttribute(line, 'NAME') ||
          hlsAttribute(line, 'LANGUAGE') ||
          'Unknown',
        kind: 'captions',
        default: /(?:^|,)\s*DEFAULT=YES(?:,|$)/i.test(line),
      })
      continue
    }
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue

    const uri = lines
      .slice(index + 1)
      .map(candidate => candidate.trim())
      .find(candidate => candidate && !candidate.startsWith('#'))
    const resolution = hlsAttribute(line, 'RESOLUTION')?.match(
      /^(\d+)\s*x\s*(\d+)$/i
    )
    if (!uri || !resolution) continue
    variants.push({
      url: new URL(uri, masterUrl).href,
      quality: qualityFromResolution(
        Number(resolution[1]),
        Number(resolution[2])
      ),
    })
  }

  return {
    variants: Array.from(
      new Map(
        variants.map(variant => [variant.quality, variant] as const)
      ).values()
    ),
    subtitles: Array.from(
      new Map(
        subtitles.map(
          subtitle => [`${subtitle.file}\n${subtitle.label}`, subtitle] as const
        )
      ).values()
    ),
  }
}

async function linksFromMaster(
  masterUrl: URL,
  sourceIndex: number
): Promise<ProviderLink[]> {
  let response: Response | undefined
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetch(masterUrl, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (response.ok) break
      await response.body?.cancel()
      lastError = new Error(
        `HTTP ${response.status} from ${masterUrl.hostname}`
      )
    } catch (error) {
      lastError = error
    }
  }
  if (!response?.ok) throw lastError || new Error('HLS manifest request failed')
  const manifest = await response.text()
  if (!manifest.includes('#EXTM3U')) throw new Error('Invalid HLS manifest')

  const { variants, subtitles } = parseManifest(manifest, masterUrl.href)
  if (variants.length === 0) {
    return [
      {
        server: `VidRift | Earth ${sourceIndex + 1}`,
        url: masterUrl.href,
        isM3U8: true,
        quality: 'auto',
        subtitles,
        requiresProxy: false,
      },
    ]
  }

  return variants.map(variant => ({
    server: `VidRift | Earth ${sourceIndex + 1} | ${variant.quality}`,
    url: masterUrl.href,
    isM3U8: true,
    quality: variant.quality,
    subtitles,
    hlsVariant: variant.url,
    requiresProxy: false,
  }))
}

async function linksFromRoot(
  candidates: URL[],
  sourceIndex: number
): Promise<ProviderLink[]> {
  let lastError: unknown
  for (const candidate of candidates) {
    try {
      return await linksFromMaster(candidate, sourceIndex)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('VidRift media root had no playable HLS master')
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
    const payload = await resolveSource(tmdbId, mediaType, season, episode)
    const rootsByOrigin = new Map<string, URL[]>()
    for (const stream of payload.streams || []) {
      const url = directStreamUrl(stream)
      if (url) {
        const roots = rootsByOrigin.get(url.origin) || []
        if (!roots.some(candidate => candidate.href === url.href))
          roots.push(url)
        rootsByOrigin.set(url.origin, roots)
      }
    }
    const uniqueRoots = Array.from(rootsByOrigin.values())
    const results = await Promise.allSettled(
      uniqueRoots.map((urls, index) => linksFromRoot(urls, index))
    )
    const links = results.flatMap(result =>
      result.status === 'fulfilled' ? result.value : []
    )
    console.log(
      `[VidRift] Extracted ${links.length} quality link(s) across ${uniqueRoots.length} distinct media root(s) for ${mediaType} ${tmdbId}`
    )
    return links
  } catch (error) {
    console.error(
      `[VidRift] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const vidRiftProvider: Provider = {
  name: 'VidRift',
  id: 'vidrift',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
