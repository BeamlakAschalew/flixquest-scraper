import type { Provider, ProviderLink, Subtitle } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'
import {
  formatRequestError,
  redactUrl,
  responseBodySnippet,
  responseDiagnostics,
} from '../utils/request-diagnostics.js'

const BASE_URL = 'https://vixsrc.to'
const REQUEST_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36'

const VIXSRC_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'max-age=0',
  Referer: `${BASE_URL}/`,
  'Sec-Ch-Ua':
    '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
}

function playlistHeaders(embedUrl: string): Record<string, string> {
  return {
    'User-Agent': USER_AGENT,
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: embedUrl,
  }
}

interface VixsrcApiResponse {
  src: string
}

interface TokenData {
  token: string
  expires: string
  playlist: string
}

interface VixsrcVariant {
  url: string
  quality: string
}

async function request(
  url: string,
  headers: Record<string, string> = VIXSRC_HEADERS,
  stage = 'request'
): Promise<Response> {
  const startedAt = Date.now()
  console.log(`[Vixsrc:${stage}] GET ${redactUrl(url)}`)
  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    console.log(
      `[Vixsrc:${stage}] Completed in ${Date.now() - startedAt}ms: ${responseDiagnostics(response)}`
    )
    if (!response.ok) {
      console.warn(
        `[Vixsrc:${stage}] Non-2xx body: ${await responseBodySnippet(response)}`
      )
      throw new Error(`HTTP ${response.status} (${response.statusText})`)
    }

    return response
  } catch (error) {
    console.error(
      `[Vixsrc:${stage}] Failed after ${Date.now() - startedAt}ms for ${redactUrl(url)}: ${formatRequestError(error)}`
    )
    throw error
  }
}

function buildApiUrl(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): string {
  return mediaType === 'movie'
    ? `${BASE_URL}/api/movie/${tmdbId}`
    : `${BASE_URL}/api/tv/${tmdbId}/${season}/${episode}`
}

async function fetchEmbedUrl(apiUrl: string): Promise<string> {
  const response = await request(apiUrl, VIXSRC_HEADERS, 'api')
  const data = (await response.json()) as Partial<VixsrcApiResponse>

  if (!data.src || typeof data.src !== 'string') {
    throw new Error('Vixsrc API did not return an embed URL')
  }

  return new URL(data.src, BASE_URL).href
}

async function fetchEmbedPage(embedUrl: string): Promise<string> {
  const response = await request(
    embedUrl,
    {
      ...VIXSRC_HEADERS,
      Accept: 'text/html,application/xhtml+xml,*/*',
    },
    'embed'
  )
  return response.text()
}

function extractTokenData(html: string): TokenData {
  const token = html.match(/token["']\s*:\s*["']([^"']+)/)?.[1]
  const expires = html.match(/expires["']\s*:\s*["']([^"']+)/)?.[1]
  const rawPlaylist = html.match(/url\s*:\s*["']([^"']+)/)?.[1]

  if (!token || !expires || !rawPlaylist) {
    throw new Error('Could not extract Vixsrc playlist credentials')
  }

  const expiryTime = Number.parseInt(expires, 10) * 1000
  if (!Number.isFinite(expiryTime) || expiryTime - 60_000 < Date.now()) {
    throw new Error('Vixsrc returned an invalid or expired token')
  }

  const playlist = rawPlaylist.replace(/\\\//g, '/').replace(/\\u0026/g, '&')
  return { token, expires, playlist }
}

function buildMasterUrl({ token, expires, playlist }: TokenData): string {
  const playlistUrl = new URL(playlist, BASE_URL).href
  const separator = playlistUrl.includes('?') ? '&' : '?'
  return `${playlistUrl}${separator}token=${token}&expires=${expires}&h=1`
}

function getAttribute(line: string, name: string): string | undefined {
  return line.match(new RegExp(`${name}="([^"]+)"`))?.[1]
}

function parseSubtitles(content: string, masterUrl: string): Subtitle[] {
  return content
    .split(/\r?\n/)
    .filter(line => line.startsWith('#EXT-X-MEDIA:TYPE=SUBTITLES'))
    .flatMap(line => {
      const uri = getAttribute(line, 'URI')
      if (!uri) return []

      const label =
        getAttribute(line, 'NAME') ||
        getAttribute(line, 'LANGUAGE') ||
        'Unknown'

      return [
        {
          file: new URL(uri, masterUrl).href,
          label,
          kind: 'captions',
          default: /DEFAULT=YES/.test(line),
        },
      ]
    })
}

function parseVariants(content: string, masterUrl: string): VixsrcVariant[] {
  const lines = content.split(/\r?\n/)
  const variants: VixsrcVariant[] = []

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue

    const uri = lines
      .slice(index + 1)
      .find(candidate => candidate.trim() && !candidate.startsWith('#'))
    if (!uri) continue

    const resolution = line.match(/(?:^|[:,])RESOLUTION=([^,]+)/)?.[1]
    const height = resolution?.match(/x(\d+)$/)?.[1]
    variants.push({
      url: new URL(uri, masterUrl).href,
      quality: height ? `${height}p` : 'auto',
    })
  }

  return variants
}

function getBestQuality(variants: VixsrcVariant[]): string {
  const heights = variants
    .map(variant => Number.parseInt(variant.quality, 10))
    .filter(Number.isFinite)

  return heights.length > 0 ? `${Math.max(...heights)}p` : 'auto'
}

export function parseVixsrcPlaylist(content: string, masterUrl: string) {
  const variants = parseVariants(content, masterUrl)
  return {
    quality: getBestQuality(variants),
    subtitles: parseSubtitles(content, masterUrl),
    variants,
  }
}

async function getVixsrcStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  const apiUrl = buildApiUrl(tmdbId, mediaType, season, episode)
  console.log(`[Vixsrc] Fetching ${apiUrl}`)

  try {
    const embedUrl = await fetchEmbedUrl(apiUrl)
    const embedHtml = await fetchEmbedPage(embedUrl)
    const masterUrl = buildMasterUrl(extractTokenData(embedHtml))
    const headers = playlistHeaders(embedUrl)
    const playlistResponse = await request(masterUrl, headers, 'playlist')
    const playlist = await playlistResponse.text()

    if (!playlist.includes('#EXTM3U')) {
      throw new Error('Vixsrc returned an invalid HLS playlist')
    }

    const { variants, subtitles, quality } = parseVixsrcPlaylist(
      playlist,
      masterUrl
    )
    if (variants.length === 0) {
      return [
        {
          server: 'vixsrc',
          url: masterUrl,
          isM3U8: true,
          quality,
          subtitles,
          headers,
          hlsAudioLanguage: 'eng',
          requiresProxy: true,
        },
      ]
    }

    // Each response entry still points at the master playlist so its separate
    // audio renditions remain available. The stream proxy filters that master
    // to the selected video variant instead of returning the silent type=video
    // media playlist directly.
    return variants.map(variant => ({
      server: `vixsrc | ${variant.quality}`,
      url: masterUrl,
      isM3U8: true,
      quality: variant.quality,
      subtitles,
      headers,
      hlsVariant: variant.url,
      hlsAudioLanguage: 'eng',
      requiresProxy: true,
    }))
  } catch (error) {
    console.error(`[Vixsrc] Provider failed: ${formatRequestError(error)}`)
    return []
  }
}

export const vixsrcProvider: Provider = {
  name: 'Vixsrc',
  alias: 'Axum',
  id: 'vixsrc',
  streamMovie: tmdbId => getVixsrcStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getVixsrcStreams(tmdbId, 'tv', season, episode),
}
