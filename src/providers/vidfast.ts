import type { Provider, ProviderLink } from '../types/index.js'

const BASE_URL = 'https://vidfast.vc'
const CRYPTO_URL = 'https://enc-dec.app/api'
const REQUEST_TIMEOUT_MS = 12_000
const HEADERS = {
  Referer: `${BASE_URL}/`,
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'X-Requested-With': 'XMLHttpRequest',
}

interface CryptoResponse<T> {
  result?: T
}

interface VidFastConfig {
  servers?: string
  stream?: string
  token?: string
}

interface VidFastServer {
  data?: string
  name?: string
  description?: string
}

interface VidFastStream {
  url?: string
  '4kAvailable'?: boolean
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
    const failedUrl = new URL(response.url || url)
    throw new Error(
      `HTTP ${response.status} from ${failedUrl.hostname}${failedUrl.pathname}`
    )
  }
  return response.text()
}

async function decrypt<T>(text: string): Promise<T | undefined> {
  const response = await fetch(`${CRYPTO_URL}/dec-vidfast`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': HEADERS['User-Agent'],
    },
    body: JSON.stringify({ text, version: '1' }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) return undefined
  return ((await response.json()) as CryptoResponse<T>).result
}

function m3u8Variants(
  content: string,
  masterUrl: string
): Array<{ url: string; quality: string }> {
  const variants: Array<{ url: string; quality: string }> = []
  const pattern = /#EXT-X-STREAM-INF:.*?RESOLUTION=(\d+x\d+).*?\n([^\n]+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content))) {
    const height = Number(match[1].split('x')[1])
    if (height < 720) continue
    variants.push({
      url: new URL(match[2].trim(), masterUrl).href,
      quality: `${height}p`,
    })
  }
  return variants
}

async function resolveServer(
  server: VidFastServer,
  streamBase: string,
  requestHeaders: Record<string, string>
): Promise<ProviderLink[]> {
  if (!server.data) return []
  const encrypted = await fetchText(
    `${streamBase.replace(/\/$/, '')}/${server.data}`,
    { method: 'POST', headers: requestHeaders }
  )
  if (!encrypted.trim()) return []

  const stream = await decrypt<VidFastStream>(encrypted)
  if (!stream?.url || !/^https?:\/\//i.test(stream.url)) return []

  const isM3U8 = /\.m3u8(?:$|[?#])/i.test(stream.url)
  const defaultQuality =
    stream['4kAvailable'] || /4k/i.test(server.description || '')
      ? '2160p'
      : '1080p'
  const candidates = [
    { url: stream.url, quality: isM3U8 ? 'auto' : defaultQuality },
  ]
  if (isM3U8) {
    try {
      candidates.push(
        ...m3u8Variants(
          await fetchText(stream.url, { headers: requestHeaders }),
          stream.url
        )
      )
    } catch {
      // The master URL itself remains a usable fallback.
    }
  }

  return candidates.map((candidate, index) => ({
    server: `vidfast-${server.name || 'default'}-${index + 1}`,
    url: candidate.url,
    isM3U8: /\.m3u8(?:$|[?#])/i.test(candidate.url),
    quality: candidate.quality,
    subtitles: [],
    headers: requestHeaders,
  }))
}

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  try {
    const pageUrl =
      mediaType === 'movie'
        ? `${BASE_URL}/movie/${encodeURIComponent(tmdbId)}/`
        : `${BASE_URL}/tv/${encodeURIComponent(tmdbId)}/${season}/${episode}/`
    const page = await fetchText(pageUrl, { headers: HEADERS })
    const encoded =
      page.match(/"en":"([^"]+)"/)?.[1] ||
      page.match(/\\"en\\":\\"([^"\\]+)\\"/)?.[1]
    if (!encoded) return []

    const configResponse = await fetch(
      `${CRYPTO_URL}/enc-vidfast?text=${encodeURIComponent(encoded)}&version=1`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    )
    if (!configResponse.ok) return []
    const config =
      (await configResponse.json()) as CryptoResponse<VidFastConfig>
    if (!config.result?.servers || !config.result.stream) return []

    const requestHeaders = {
      ...HEADERS,
      ...(config.result.token ? { 'X-CSRF-Token': config.result.token } : {}),
    }
    const encryptedServers = await fetchText(config.result.servers, {
      method: 'POST',
      headers: requestHeaders,
    })
    const servers = await decrypt<VidFastServer[]>(encryptedServers)
    if (!servers?.length) return []

    const resolved = await Promise.all(
      servers.map(server =>
        resolveServer(server, config.result!.stream!, requestHeaders).catch(
          () => []
        )
      )
    )
    const links = resolved.flat()
    console.log(`[VidFast] Extracted ${links.length} candidate stream(s)`)
    return links
  } catch (error) {
    console.error(
      `[VidFast] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const vidFastProvider: Provider = {
  name: 'VidFast',
  id: 'vidfast',
  alias: 'Lalibela',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
