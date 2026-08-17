import type { Provider, ProviderLink } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'

const SITE_ORIGIN = 'https://cinevaro.app'
const RESOLVER_ORIGIN =
  process.env.CINEVARO_API_BASE_URL?.trim() || 'https://resolver2.cinevaro.app'
const RESOLVER_KEY = process.env.CINEVARO_API_KEY?.trim() || '123123'
const REQUEST_TIMEOUT_MS = Math.min(DEFAULT_REQUEST_TIMEOUT_MS, 30_000)
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'

const API_HEADERS = {
  Accept: 'application/json',
  Origin: SITE_ORIGIN,
  Referer: `${SITE_ORIGIN}/`,
  'User-Agent': USER_AGENT,
  'X-API-Key': RESOLVER_KEY,
}

const PLAYBACK_HEADERS = {
  Accept: '*/*',
  Origin: SITE_ORIGIN,
  Referer: `${SITE_ORIGIN}/`,
  'User-Agent': USER_AGENT,
}

interface CinevaroStream {
  url?: string
  label?: string
  quality?: string
}

interface CinevaroPayload {
  ok?: boolean
  error?: string
  streams?: CinevaroStream[]
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
    return /^https?:$/.test(url.protocol) ? url : null
  } catch {
    return null
  }
}

function hlsAttribute(line: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = line.match(
    new RegExp(
      `(?:^|,)\\s*${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^,\\r\\n]*))`,
      'i'
    )
  )
  return (match?.[1] ?? match?.[2] ?? match?.[3])?.trim()
}

function qualityFromResolution(width: number, height: number): string {
  // Cinemascope video often stores 1920x800 or 1280x534 while still being
  // marketed as the 1080p/720p delivery tier. Use width and height together.
  if (width >= 3800 || height >= 1600) return '2160p'
  if (width >= 1900 || height >= 1000) return '1080p'
  if (width >= 1200 || height >= 650) return '720p'
  if (width >= 800 || height >= 430) return '480p'
  if (width >= 600 || height >= 300) return '360p'
  return height > 0 ? `${height}p` : 'auto'
}

function parseVariants(manifest: string, masterUrl: string): HlsVariant[] {
  const lines = manifest.split(/\r?\n/)
  const variants: HlsVariant[] = []

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim()
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue
    const resolution = hlsAttribute(line, 'RESOLUTION')?.match(
      /^(\d+)\s*x\s*(\d+)$/i
    )
    const uri = lines
      .slice(index + 1)
      .map(candidate => candidate.trim())
      .find(candidate => candidate && !candidate.startsWith('#'))
    if (!resolution || !uri) continue

    try {
      variants.push({
        url: new URL(uri, masterUrl).href,
        quality: qualityFromResolution(
          Number(resolution[1]),
          Number(resolution[2])
        ),
      })
    } catch {
      // A malformed rendition does not invalidate the other variants.
    }
  }

  return Array.from(
    new Map(
      variants.map(variant => [variant.quality, variant] as const)
    ).values()
  )
}

async function linksFromStream(
  stream: CinevaroStream,
  index: number,
  providerName: string
): Promise<ProviderLink[]> {
  const masterUrl = validHttpUrl(stream.url)
  if (!masterUrl) return []
  const server = `${providerName} | ${stream.label?.trim() || `Server ${index + 1}`}`

  try {
    const response = await fetch(masterUrl, {
      headers: PLAYBACK_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      await response.body?.cancel()
      return []
    }
    const finalUrl = response.url || masterUrl.href
    const manifest = await response.text()
    const variants = parseVariants(manifest, finalUrl)
    if (variants.length > 0) {
      return variants.map(variant => ({
        server: `${server} | ${variant.quality}`,
        url: variant.url,
        isM3U8: true,
        quality: variant.quality,
        subtitles: [],
        headers: PLAYBACK_HEADERS,
      }))
    }
  } catch {
    // The resolver's master URL is still directly playable if inspecting its
    // variant ladder fails or times out.
  }

  return [
    {
      server,
      url: masterUrl.href,
      isM3U8: true,
      quality: stream.quality?.trim() || 'auto',
      subtitles: [],
      headers: PLAYBACK_HEADERS,
    },
  ]
}

async function resolve(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  resolverSource: string,
  providerName: string,
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

  const url = new URL(`/api/test/${tmdbId}`, RESOLVER_ORIGIN)
  url.searchParams.set('source', resolverSource)
  if (mediaType === 'tv') {
    url.searchParams.set('season', String(season))
    url.searchParams.set('episode', String(episode))
  }

  const response = await fetch(url, {
    headers: API_HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (response.status === 404) return []
  if (!response.ok) {
    const details = (await response.text()).slice(0, 200)
    throw new Error(
      `Cinevaro resolver failed with HTTP ${response.status}${details ? `: ${details}` : ''}`
    )
  }

  const payload = (await response.json()) as CinevaroPayload
  if (!payload.ok) return []

  const results = await Promise.all(
    (payload.streams || []).map((stream, index) =>
      linksFromStream(stream, index, providerName)
    )
  )
  return Array.from(
    new Map(
      results.flat().map(link => [`${link.url}|${link.quality}`, link] as const)
    ).values()
  )
}

export function createCinevaroResolverProvider(
  name: string,
  id: string,
  resolverSource: string
): Provider {
  return {
    name,
    id,
    streamMovie: tmdbId => resolve(tmdbId, 'movie', resolverSource, name),
    streamTV: (tmdbId, season, episode) =>
      resolve(tmdbId, 'tv', resolverSource, name, season, episode),
  }
}

export const cinevaroProvider = createCinevaroResolverProvider(
  'Cinevaro',
  'cinevaro',
  'vaplayer'
)
