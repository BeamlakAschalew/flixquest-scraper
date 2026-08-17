import type { Provider, ProviderLink } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'

const BASE_URLS = ['https://fsharetv.co', 'https://fsharetv.cc'] as const
const REQUEST_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'

interface FshareSource {
  src?: string
  label?: string
  type?: string
  quality?: string | number
  storage?: string
}

interface FsharePayload {
  status?: string
  data?: {
    file?: {
      sources?: FshareSource[]
      backups?: FshareSource[]
      alternatives?: FshareSource[][]
    }
  }
}

function isValidTmdbId(tmdbId: string): boolean {
  return /^\d+$/.test(tmdbId)
}

async function lookupImdbId(tmdbId: string): Promise<string | null> {
  const apiKey = process.env.TMDB_API_KEY?.trim()
  if (!apiKey) return null

  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${encodeURIComponent(apiKey)}`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    )
    if (!response.ok) return null

    const payload = (await response.json()) as { imdb_id?: string }
    const imdbId = payload.imdb_id?.trim()
    return imdbId && /^tt\d{5,}$/i.test(imdbId) ? imdbId : null
  } catch {
    return null
  }
}

function qualityLabel(source: FshareSource): string {
  const value = `${source.quality ?? ''} ${source.label ?? ''}`
  const match = value.match(/\b(2160|1440|1080|720|576|540|480|360|240)p?\b/i)
  return match ? `${match[1]}p` : 'unknown'
}

function sourcePageValues(html: string): {
  sourceId: string
  trailer: string
} | null {
  const sourceId =
    html.match(/Movie\.setSource\(\s*['"]([^'"]+)['"]/i)?.[1]?.trim() ||
    html
      .match(/\b(?:source_id|file_id)\s*[=:]\s*['"]([^'"]+)['"]/i)?.[1]
      ?.trim()
  const trailer =
    html
      .match(/\bid=["']trailer["'][^>]*\bvalue=["']([^"']+)["']/i)?.[1]
      ?.trim() ||
    html
      .match(/\bvalue=["']([^"']+)["'][^>]*\bid=["']trailer["']/i)?.[1]
      ?.trim()

  return sourceId && trailer && /^[A-Za-z0-9+@=_-]+$/.test(sourceId)
    ? { sourceId, trailer }
    : null
}

function candidateSources(payload: FsharePayload): FshareSource[] {
  const file = payload.data?.file
  const entries = [
    ...(file?.sources || []),
    ...(file?.backups || []),
    ...(file?.alternatives || []).flat(),
  ]
  const byQuality = new Map<string, FshareSource>()

  for (const source of entries) {
    if (!source.src) continue
    const quality = qualityLabel(source)
    if (!byQuality.has(quality)) byQuality.set(quality, source)
  }

  return Array.from(byQuality.values()).sort(
    (left, right) =>
      Number.parseInt(qualityLabel(right), 10) -
      Number.parseInt(qualityLabel(left), 10)
  )
}

async function resolveFromBase(
  baseUrl: string,
  imdbId: string
): Promise<ProviderLink[]> {
  const watchUrl = `${baseUrl}/w/${encodeURIComponent(imdbId)}`
  const pageResponse = await fetch(watchUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': USER_AGENT,
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (pageResponse.status === 404) return []
  if (!pageResponse.ok) {
    throw new Error(
      `FshareTV watch page failed with HTTP ${pageResponse.status}`
    )
  }

  const values = sourcePageValues(await pageResponse.text())
  if (!values) return []

  // FshareTV treats its opaque token as a literal route component and returns
  // HTTP 500 when characters such as `+` and `=` are percent-encoded.
  const apiUrl = new URL(`/api/file/${values.sourceId}/source`, baseUrl)
  apiUrl.searchParams.set('trailer', values.trailer)
  apiUrl.searchParams.set('type', 'watch')

  const apiResponse = await fetch(apiUrl, {
    headers: {
      Accept: 'application/json, */*; q=0.01',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: watchUrl,
      'User-Agent': USER_AGENT,
      'X-Requested-With': 'XMLHttpRequest',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (apiResponse.status === 404) return []
  if (!apiResponse.ok) {
    throw new Error(
      `FshareTV source API failed with HTTP ${apiResponse.status}`
    )
  }

  const payload = (await apiResponse.json()) as FsharePayload
  if (payload.status !== 'ok') return []

  const playbackHeaders = {
    Accept: '*/*',
    Referer: watchUrl,
    'User-Agent': USER_AGENT,
  }

  return candidateSources(payload).flatMap((source): ProviderLink[] => {
    try {
      const url = new URL(source.src!, baseUrl)
      if (!/^https?:$/.test(url.protocol)) return []
      const quality = qualityLabel(source)
      return [
        {
          server: `FshareTV | ${quality}${source.storage ? ` | ${source.storage}` : ''}`,
          url: url.href,
          isM3U8: /mpegurl|m3u8/i.test(`${source.type || ''} ${url.href}`),
          quality,
          subtitles: [],
          headers: playbackHeaders,
          requiresProxy: true,
        },
      ]
    } catch {
      return []
    }
  })
}

async function resolveMovie(tmdbId: string): Promise<ProviderLink[]> {
  if (!isValidTmdbId(tmdbId)) return []
  const imdbId = await lookupImdbId(tmdbId)
  if (!imdbId) return []

  let lastError: unknown
  for (const baseUrl of BASE_URLS) {
    try {
      const links = await resolveFromBase(baseUrl, imdbId)
      if (links.length > 0) return links
    } catch (error) {
      lastError = error
    }
  }

  if (lastError) {
    throw lastError instanceof Error
      ? lastError
      : new Error('FshareTV resolution failed')
  }
  return []
}

export const fshareTvProvider: Provider = {
  name: 'FshareTV',
  id: 'fsharetv',
  streamMovie: resolveMovie,
  // FMHY lists FshareTV as a movie-only dedicated server.
  streamTV: async () => [],
}
