/**
 * VidUp streaming provider.
 *
 * Current protocol (verified 2026-08-09 against https://vidup.to, a Next.js
 * app that structurally matches the VidFast player family):
 * 1. Fetch the embed page (/movie/{id} or /tv/{id}/{s}/{e}) and extract the
 *    `en` configuration value from the server-rendered RSC payload.
 * 2. Ask enc-dec.app (the same public decryptor the VidFast/Vidlink
 *    providers already use) for `enc-vidup?text={en}&version=1`, which
 *    yields { servers, stream, token }.
 * 3. POST the `servers` URL with X-CSRF-Token + Referer, then decrypt the
 *    body with `dec-vidup` to get [{ name, description, data }].
 * 4. For each server, POST {stream}/{data} and decrypt again to get
 *    { url, tracks, 4kAvailable, ... }.
 * The `en` value, server list and tokens rotate on every page load, and the
 * resolved stream endpoints are session-bound, so nothing may be cached.
 */
import type { Provider, ProviderLink, Subtitle } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'

const BASE_URL = 'https://vidup.to'
const CRYPTO_URL = 'https://enc-dec.app/api'
const REQUEST_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'

const PAGE_HEADERS: Record<string, string> = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: `${BASE_URL}/`,
  'User-Agent': USER_AGENT,
}

const API_HEADERS: Record<string, string> = {
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: `${BASE_URL}/`,
  'User-Agent': USER_AGENT,
  'X-Requested-With': 'XMLHttpRequest',
  // The proxy cannot forward VidUp's long session-bound /gut POST URLs.
  // Page/config/decrypt requests can still use the proxy; these API calls
  // must use the server's direct egress.
  'x-skip-forward-proxy': 'true',
}

const PLAYBACK_HEADERS: Record<string, string> = {
  Accept: '*/*',
  Referer: `${BASE_URL}/`,
  'User-Agent': USER_AGENT,
}

interface CryptoResponse<T> {
  result?: T
}

interface VidUpConfig {
  servers?: string
  stream?: string
  token?: string
}

interface VidUpServer {
  data?: string
  name?: string
  description?: string
}

interface VidUpStream {
  url?: string
  '4kAvailable'?: boolean
  noReferrer?: boolean
  tracks?: Array<{
    url?: string
    label?: string
    language?: string
    kind?: string
  }>
}

function isValidTmdbId(tmdbId: string): boolean {
  return /^\d+$/.test(tmdbId)
}

function isValidEpisodeNumber(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

async function fetchText(
  url: string,
  options: RequestInit = {}
): Promise<string> {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    const failed = new URL(response.url || url)
    throw new Error(
      `HTTP ${response.status} from ${failed.hostname}${failed.pathname}`
    )
  }
  return response.text()
}

async function decrypt<T>(text: string): Promise<T | undefined> {
  const response = await fetch(`${CRYPTO_URL}/dec-vidup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({ text, version: '1' }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) return undefined
  return ((await response.json()) as CryptoResponse<T>).result
}

// Pulls the `en` configuration out of the Next.js RSC payload embedded in
// the embed page. The page HTML is re-read each request instead of relying
// on a hashed chunk filename.
async function fetchEncodedConfig(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<string | undefined> {
  const pageUrl =
    mediaType === 'movie'
      ? `${BASE_URL}/movie/${encodeURIComponent(tmdbId)}?autoPlay=true`
      : `${BASE_URL}/tv/${encodeURIComponent(tmdbId)}/${season}/${episode}?autoPlay=true`
  const page = await fetchText(pageUrl, { headers: PAGE_HEADERS })
  const encoded =
    page.match(/"en":"([^"]+)"/)?.[1] ||
    page.match(/\\"en\\":\\"([^"\\]+)\\"/)?.[1]
  if (!encoded) {
    console.error(
      `[VidUp] No en configuration found on ${mediaType} page for ${tmdbId}`
    )
    return undefined
  }
  return encoded
}

function isValidMediaUrl(value: string | undefined): URL | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url : null
  } catch {
    return null
  }
}

function subtitlesFrom(stream: VidUpStream): Subtitle[] {
  return (stream.tracks || []).flatMap(track => {
    const url = isValidMediaUrl(track.url)
    if (!url) return []
    return [
      {
        file: url.href,
        label: track.label || track.language || 'Unknown',
        kind: track.kind || 'captions',
      },
    ]
  })
}

async function resolveServer(
  server: VidUpServer,
  streamBase: string,
  requestHeaders: Record<string, string>
): Promise<ProviderLink[]> {
  if (!server.data) return []
  const encrypted = await fetchText(
    `${streamBase.replace(/\/$/, '')}/${server.data}`,
    { method: 'POST', headers: requestHeaders }
  )
  if (!encrypted.trim()) return []

  const stream = await decrypt<VidUpStream>(encrypted)
  const streamUrl = isValidMediaUrl(stream?.url)
  if (!streamUrl) return []

  const isM3U8 = /\.m3u8(?:$|[?#])/i.test(streamUrl.href)
  const defaultQuality =
    stream?.['4kAvailable'] || /4k/i.test(server.description || '')
      ? '2160p'
      : '1080p'
  const playbackHeaders = {
    ...PLAYBACK_HEADERS,
    ...(stream?.noReferrer ? {} : { Referer: `${BASE_URL}/` }),
  }
  return [
    {
      server: `vidup-${server.name || 'default'}`,
      url: streamUrl.href,
      isM3U8,
      isDASH: /\.mpd(?:$|[?#])/i.test(streamUrl.href),
      quality: isM3U8 ? 'auto' : defaultQuality,
      subtitles: subtitlesFrom(stream || {}),
      headers: playbackHeaders,
      requiresProxy: false,
    },
  ]
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
    const encoded = await fetchEncodedConfig(tmdbId, mediaType, season, episode)
    if (!encoded) return []

    const configResponse = await fetch(
      `${CRYPTO_URL}/enc-vidup?text=${encodeURIComponent(encoded)}&version=1`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    )
    if (!configResponse.ok) return []
    const config = (await configResponse.json()) as CryptoResponse<VidUpConfig>
    if (!config.result?.servers || !config.result.stream) return []

    const requestHeaders = {
      ...API_HEADERS,
      ...(config.result.token ? { 'X-CSRF-Token': config.result.token } : {}),
    }
    const encryptedServers = await fetchText(config.result.servers, {
      method: 'POST',
      headers: requestHeaders,
    })
    const servers = await decrypt<VidUpServer[]>(encryptedServers)
    if (!servers?.length) return []

    const resolved = await Promise.all(
      servers.map(server =>
        resolveServer(server, config.result!.stream!, requestHeaders).catch(
          () => []
        )
      )
    )
    const links = Array.from(
      new Map(
        resolved
          .flat()
          .map(link => [link.url, link] as const)
          .values()
      ).values()
    )
    console.log(
      `[VidUp] Extracted ${links.length} candidate stream(s) for ${mediaType} ${tmdbId}`
    )
    return links
  } catch (error) {
    console.error(
      `[VidUp] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const vidUpProvider: Provider = {
  name: 'VidUp',
  id: 'vidup',
  alias: 'Gura',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
