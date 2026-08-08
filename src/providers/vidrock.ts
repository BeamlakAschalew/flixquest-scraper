/**
 * VidRock streaming provider.
 *
 * Current protocol (verified 2026-08-09 against https://vidrock.ru):
 * 1. GET {base}/api/{movie|tv}/{tmdbId}[/{season}/{episode}] with the raw
 *    TMDB ID (no item-ID encryption on the request path anymore).
 * 2. The response is a server map: { serverName: { url, type, language, flag } }.
 *    Each non-null `url` is a base64url AES-GCM ciphertext (12-byte IV prefix).
 *    The key is the hex string below, shipped inside the public frontend
 *    bundle. Decrypt locally with Node WebCrypto.
 * 3. Some entries point to secondary JSON playlists (legacy hls2.vdrk.site,
 *    cdn.vidrock.store/playlist/... or proxy.vidrock.store/...). Those return
 *    [{ resolution, url }] and are expanded into per-quality links.
 * 4. Subtitles: GET https://sub.vdrk.site/v2/{movie|tv}/{id}[/{s}/{e}] which
 *    returns [{ label, file }].
 * Playback of stream URLs requires Referer/Origin headers, so links are
 * marked requiresProxy so the API proxy injects them.
 */
import type { Provider, ProviderLink, Subtitle } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'

const BASE_URL = 'https://vidrock.ru'
const SUB_BASE_URL = 'https://sub.vdrk.site'
const REQUEST_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'

const API_HEADERS: Record<string, string> = {
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: `${BASE_URL}/`,
  Origin: BASE_URL,
  'User-Agent': USER_AGENT,
}

const PLAYBACK_HEADERS: Record<string, string> = {
  Accept: '*/*',
  Referer: `${BASE_URL}/`,
  Origin: BASE_URL,
  'User-Agent': USER_AGENT,
}

// Public AES-GCM key from the current VidRock frontend bundle. Stream URLs
// are base64url-encoded ciphertext: first 12 bytes IV, then the ciphertext.
const STREAM_KEY_HEX =
  '7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f'

interface VidRockStreamInfo {
  url?: string | null
  type?: string | null
  language?: string | null
  flag?: string | null
}

type VidRockStreams = Record<string, VidRockStreamInfo>

interface VidRockPlaylistEntry {
  resolution?: number | string
  url?: string
}

function isValidTmdbId(tmdbId: string): boolean {
  return /^\d+$/.test(tmdbId)
}

function isValidEpisodeNumber(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function base64UrlToBytes(value: string): Uint8Array {
  let base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const remainder = base64.length % 4
  if (remainder === 2) base64 += '=='
  else if (remainder === 3) base64 += '='
  else if (remainder === 1) throw new Error('Invalid base64url length')
  return new Uint8Array(Buffer.from(base64, 'base64'))
}

let streamKeyPromise: Promise<CryptoKey> | undefined

function getStreamKey(): Promise<CryptoKey> {
  if (!streamKeyPromise) {
    streamKeyPromise = (async () => {
      const bytes = new Uint8Array(STREAM_KEY_HEX.length / 2)
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Number.parseInt(STREAM_KEY_HEX.substr(i * 2, 2), 16)
      }
      return crypto.subtle.importKey(
        'raw',
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ),
        { name: 'AES-GCM' },
        false,
        ['decrypt']
      )
    })()
  }
  return streamKeyPromise
}

async function decryptStreamUrl(ciphertext: string): Promise<string> {
  const bytes = base64UrlToBytes(ciphertext)
  if (bytes.length < 28) throw new Error('Ciphertext too short')
  const iv = bytes.slice(0, 12)
  const encrypted = bytes.slice(12)
  const key = await getStreamKey()
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + 12) },
    key,
    encrypted.buffer.slice(
      encrypted.byteOffset,
      encrypted.byteOffset + encrypted.byteLength
    )
  )
  return new TextDecoder().decode(plain)
}

async function fetchJson<T>(
  url: string,
  headers: Record<string, string>
): Promise<T> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    const failed = new URL(response.url || url)
    throw new Error(
      `HTTP ${response.status} from ${failed.hostname}${failed.pathname}`
    )
  }
  return (await response.json()) as T
}

function normalizedQuality(value: string | number | undefined): string {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
  const match = raw.match(/(\d{3,4})p/)
  if (match) return `${match[1]}p`
  if (raw.includes('2160') || raw.includes('4k')) return '2160p'
  if (raw.includes('1080')) return '1080p'
  if (raw.includes('720')) return '720p'
  if (raw.includes('480')) return '480p'
  if (raw.includes('360')) return '360p'
  return 'auto'
}

function streamTypeOf(url: string, declared?: string | null): 'hls' | 'mp4' {
  const type = (declared ?? '').toLowerCase()
  if (type === 'mp4' || /\.mp4(?:$|[?#])/i.test(url)) return 'mp4'
  return 'hls'
}

function isProxyPrefixUrl(url: string): boolean {
  return url.startsWith('https://proxy.vidrock.store/')
}

function unwrapProxyUrl(url: string): string {
  const path = url.slice('https://proxy.vidrock.store/'.length)
  return decodeURIComponent(path.replace(/^\//, ''))
}

async function expandPlaylistUrl(
  url: string,
  serverName: string
): Promise<ProviderLink[]> {
  const playlist = await fetchJson<VidRockPlaylistEntry[]>(
    url,
    PLAYBACK_HEADERS
  )
  if (!Array.isArray(playlist)) return []
  const links: ProviderLink[] = []
  for (const entry of playlist) {
    if (!entry.url || typeof entry.url !== 'string') continue
    let resolved = entry.url
    if (isProxyPrefixUrl(resolved)) {
      try {
        resolved = unwrapProxyUrl(resolved)
      } catch {
        continue
      }
    }
    let parsed: URL
    try {
      parsed = new URL(resolved)
    } catch {
      continue
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) continue
    links.push({
      server: `vidrock-${serverName}-${entry.resolution ?? 'auto'}`,
      url: parsed.href,
      isM3U8: /\.m3u8(?:$|[?#])/i.test(parsed.href),
      isDASH: /\.mpd(?:$|[?#])/i.test(parsed.href),
      quality: normalizedQuality(entry.resolution),
      subtitles: [],
      headers: PLAYBACK_HEADERS,
      requiresProxy: true,
    })
  }
  return links
}

async function buildStreamLinks(
  streams: VidRockStreams
): Promise<ProviderLink[]> {
  const links: ProviderLink[] = []
  for (const [serverName, stream] of Object.entries(streams)) {
    if (!stream?.url) continue
    let finalUrl: string
    try {
      // Current API ciphers every stream URL; percent-encoded plaintext URLs
      // from older origins are handled as a fallback.
      finalUrl = stream.url.includes('%')
        ? decodeURIComponent(stream.url)
        : await decryptStreamUrl(stream.url)
    } catch (error) {
      console.error(
        `[VidRock] Failed to decrypt stream url for ${serverName}: ${error instanceof Error ? error.message : 'unknown error'}`
      )
      continue
    }

    if (
      finalUrl.includes('hls2.vdrk.site') ||
      finalUrl.includes('/playlist/') ||
      isProxyPrefixUrl(finalUrl)
    ) {
      try {
        const expanded = await expandPlaylistUrl(finalUrl, serverName)
        links.push(...expanded)
      } catch {
        // The playlist URL itself may still be directly playable.
        links.push({
          server: `vidrock-${serverName}-auto`,
          url: finalUrl,
          isM3U8: /\.m3u8(?:$|[?#])/i.test(finalUrl),
          quality: 'auto',
          subtitles: [],
          headers: PLAYBACK_HEADERS,
          requiresProxy: true,
        })
      }
      continue
    }

    let parsed: URL
    try {
      parsed = new URL(finalUrl)
    } catch {
      continue
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) continue
    const isM3U8 = streamTypeOf(parsed.href, stream.type) === 'hls'
    links.push({
      server: `vidrock-${serverName}`,
      url: parsed.href,
      isM3U8,
      isDASH: /\.mpd(?:$|[?#])/i.test(parsed.href),
      quality: isM3U8 ? 'auto' : '1080p',
      subtitles: [],
      headers: PLAYBACK_HEADERS,
      requiresProxy: true,
    })
  }
  return links
}

function subtitleFrom(entry: {
  label?: string
  file?: string
}): Subtitle | null {
  if (!entry.file || !/^https?:\/\//i.test(entry.file)) return null
  return {
    file: entry.file,
    label: entry.label || 'Unknown',
    kind: 'captions',
  }
}

async function fetchSubtitles(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<Subtitle[]> {
  const subUrl =
    mediaType === 'movie'
      ? `${SUB_BASE_URL}/v2/movie/${tmdbId}`
      : `${SUB_BASE_URL}/v2/tv/${tmdbId}/${season}/${episode}`
  try {
    const entries = await fetchJson<Array<{ label?: string; file?: string }>>(
      subUrl,
      { ...API_HEADERS, Referer: `${BASE_URL}/` }
    )
    return Array.isArray(entries)
      ? entries
          .map(subtitleFrom)
          .filter((entry): entry is Subtitle => entry !== null)
      : []
  } catch (error) {
    console.error(
      `[VidRock] Subtitles unavailable: ${error instanceof Error ? error.message : 'unknown error'}`
    )
    return []
  }
}

function deduplicateLinks(links: ProviderLink[]): ProviderLink[] {
  return Array.from(
    new Map(links.map(link => [link.url, link] as const)).values()
  )
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
    const apiPath =
      mediaType === 'movie'
        ? `movie/${tmdbId}`
        : `tv/${tmdbId}/${season}/${episode}`
    const streams = await fetchJson<VidRockStreams>(
      `${BASE_URL}/api/${apiPath}`,
      API_HEADERS
    )
    if (!streams || typeof streams !== 'object') return []

    const links = await buildStreamLinks(streams)
    const subtitles = await fetchSubtitles(tmdbId, mediaType, season, episode)
    for (const link of links) {
      link.subtitles = subtitles
    }
    const unique = deduplicateLinks(links)
    console.log(
      `[VidRock] Extracted ${unique.length} candidate stream(s) for ${mediaType} ${tmdbId}`
    )
    return unique
  } catch (error) {
    console.error(
      `[VidRock] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const vidRockProvider: Provider = {
  name: 'VidRock',
  id: 'vidrock',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
