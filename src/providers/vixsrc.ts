import type { Provider, ProviderLink, Subtitle } from '../types/index.js'

const BASE_URL = 'https://vixsrc.to'
const REQUEST_TIMEOUT_MS = 10_000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36'

const VIXSRC_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: BASE_URL,
  Origin: BASE_URL,
}

interface VixsrcApiResponse {
  src: string
}

interface TokenData {
  token: string
  expires: string
  playlist: string
}

async function request(
  url: string,
  headers = VIXSRC_HEADERS
): Promise<Response> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`Request to ${url} failed with HTTP ${response.status}`)
  }

  return response
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
  const response = await request(apiUrl)
  const data = (await response.json()) as Partial<VixsrcApiResponse>

  if (!data.src || typeof data.src !== 'string') {
    throw new Error('Vixsrc API did not return an embed URL')
  }

  return new URL(data.src, BASE_URL).href
}

async function fetchEmbedPage(embedUrl: string): Promise<string> {
  const response = await request(embedUrl, {
    ...VIXSRC_HEADERS,
    Accept: 'text/html,application/xhtml+xml,*/*',
  })
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

function getBestQuality(content: string): string {
  const heights = Array.from(
    content.matchAll(/#EXT-X-STREAM-INF:[^\n]*RESOLUTION=\d+x(\d+)/g),
    match => Number.parseInt(match[1], 10)
  ).filter(Number.isFinite)

  return heights.length > 0 ? `${Math.max(...heights)}p` : 'auto'
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
    const playlistResponse = await request(masterUrl, {
      ...VIXSRC_HEADERS,
      Referer: apiUrl,
    })
    const playlist = await playlistResponse.text()

    if (!playlist.includes('#EXTM3U')) {
      throw new Error('Vixsrc returned an invalid HLS playlist')
    }

    return [
      {
        server: 'vixsrc',
        url: masterUrl,
        isM3U8: true,
        quality: getBestQuality(playlist),
        subtitles: parseSubtitles(playlist, masterUrl),
        headers: {
          Referer: apiUrl,
          'User-Agent': USER_AGENT,
        },
      },
    ]
  } catch (error) {
    console.error(
      `[Vixsrc] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const vixsrcProvider: Provider = {
  name: 'Vixsrc',
  id: 'vixsrc',
  streamMovie: tmdbId => getVixsrcStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getVixsrcStreams(tmdbId, 'tv', season, episode),
}
