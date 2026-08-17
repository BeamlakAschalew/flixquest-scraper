/**
 * VidNest streaming provider.
 *
 * Current protocol (verified 2026-08-09):
 * 1. GET https://new.vidnest.fun/{server}/{movie|tv}/{tmdbId}[/{season}/{episode}]
 *    where {server} maps a friendly name to the upstream server path:
 *      prime/sigma -> hollymoviehd, lamda/delta -> allmovies, catflix -> videasy,
 *      gama -> vidzee, zeta -> nextgencloudfabric, ophim -> klikxxi,
 *      beta -> vidxyz, alfa -> moviesapi, hexa -> vidlink, moviebox -> moviebox.
 * 2. Responses are either plain JSON or { encrypted: true, data } where data
 *    is encoded with the custom VidNest Base64 alphabet below. Decode and
 *    JSON.parse locally.
 * 3. Response shapes differ per server; each handler below maps its shape to
 *    ProviderLink. Dead servers (purstream, onehd currently 502) are omitted.
 * 4. Several upstreams return short-lived signed URLs (moviebox `sign`/`t`,
 *    beta `t`/`s`/`e`, alfa `?v=`), so responses must not be cached.
 */
import type { Provider, ProviderLink, Subtitle } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'

const API_BASE_URL = 'https://new.vidnest.fun'
const PLAYER_BASE_URL = 'https://vidnest.fun'
const REQUEST_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'

const API_HEADERS: Record<string, string> = {
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: `${PLAYER_BASE_URL}/`,
  Origin: PLAYER_BASE_URL,
  'User-Agent': USER_AGENT,
}

// Custom Base64 alphabet taken from the current VidNest frontend bundle.
const VIDNEST_ALPHABET =
  'RB0fpH8ZEyVLkv7c2i6MAJ5u3IKFDxlS1NTsnGaqmXYdUrtzjwObCgQP94hoeW+/='

const VIDNEST_REVERSE_MAP: Record<string, number> = (() => {
  const map: Record<string, number> = {}
  for (let i = 0; i < VIDNEST_ALPHABET.length; i++) {
    map[VIDNEST_ALPHABET[i]!] = i
  }
  return map
})()

function decodeVidnestBase64(input: string): string {
  if (!input || typeof input !== 'string') {
    throw new Error('VidNest: invalid payload, expected non-empty string')
  }
  let padded = input
  const remainder = padded.length % 4
  if (remainder !== 0) padded += '='.repeat(4 - remainder)

  const bytes: number[] = []
  for (let i = 0; i < padded.length; i += 4) {
    const chunk = padded.slice(i, i + 4)
    const c0 = VIDNEST_REVERSE_MAP[chunk[0]!] ?? 64
    const c1 = VIDNEST_REVERSE_MAP[chunk[1]!] ?? 64
    const c2 = chunk[2] === '=' ? 64 : (VIDNEST_REVERSE_MAP[chunk[2]!] ?? 64)
    const c3 = chunk[3] === '=' ? 64 : (VIDNEST_REVERSE_MAP[chunk[3]!] ?? 64)
    bytes.push(((c0 << 2) | (c1 >> 4)) & 0xff)
    if (c2 !== 64) bytes.push((((c1 & 0x0f) << 4) | (c2 >> 2)) & 0xff)
    if (c3 !== 64) bytes.push((((c2 & 0x03) << 6) | c3) & 0xff)
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

function decryptResponse<T>(
  payload: { encrypted: boolean; data: string } | T
): T {
  if (
    payload &&
    typeof payload === 'object' &&
    'encrypted' in payload &&
    (payload as { encrypted: boolean }).encrypted === true
  ) {
    const data = (payload as { data: string }).data
    if (!data || typeof data !== 'string') {
      throw new Error('VidNest: response missing encrypted data field')
    }
    try {
      return JSON.parse(decodeVidnestBase64(data)) as T
    } catch (error) {
      throw new Error(
        `VidNest: failed to parse decrypted payload as JSON: ${error instanceof Error ? error.message : 'unknown error'}`
      )
    }
  }
  return payload as T
}

interface VidNestServer {
  name: string
  path: string
}

// Friendly name -> upstream API path. Verified live on 2026-08-09.
const SERVERS: VidNestServer[] = [
  { name: 'Prime', path: 'hollymoviehd' },
  { name: 'Sigma', path: 'hollymoviehd' },
  { name: 'Lamda', path: 'allmovies' },
  { name: 'Delta', path: 'allmovies' },
  { name: 'MovieBox', path: 'moviebox' },
  { name: 'Catflix', path: 'videasy' },
  { name: 'Gama', path: 'vidzee' },
  { name: 'Zeta', path: 'nextgencloudfabric' },
  { name: 'Ophim', path: 'klikxxi' },
  { name: 'Beta', path: 'vidxyz' },
  { name: 'Alfa', path: 'moviesapi' },
  { name: 'Hexa', path: 'vidlink' },
]

interface StreamEntry {
  url?: string
  type?: string
  language?: string
  quality?: string
  headers?: Record<string, string>
}

interface SingleUrlResponse {
  url?: string
  headers?: Record<string, string>
  label?: string
  all_urls?: string[]
}

interface VidlinkResponse {
  data?: {
    stream?: {
      playlist?: string
      type?: string
      captions?: Array<{ url?: string; language?: string }>
    }
  }
  headers?: Record<string, string>
}

interface MovieBoxResponse {
  url?: Array<{
    lang?: string
    link?: string
    resolution?: string
    type?: string
  }>
}

interface SubtitleResponse {
  subtitles?: Array<{ url?: string; lang?: string }>
}

function isValidTmdbId(tmdbId: string): boolean {
  return /^\d+$/.test(tmdbId)
}

function isValidEpisodeNumber(value: number): boolean {
  return Number.isInteger(value) && value > 0
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

function inferStreamType(
  declared: string | undefined,
  url: string
): 'hls' | 'mp4' {
  const type = (declared ?? '').toLowerCase()
  if (type === 'dash' || /\.mpd(?:$|[?#])/i.test(url)) return 'mp4'
  if (type === 'mp4' || type === 'video/mp4' || /\.mp4(?:$|[?#])/i.test(url))
    return 'mp4'
  if (
    type === 'hls' ||
    type === 'application/vnd.apple.mpegurl' ||
    /\.m3u8(?:$|[?#])/i.test(url)
  ) {
    return 'hls'
  }
  return /\.m3u8(?:$|[?#])/i.test(url) ? 'hls' : 'mp4'
}

function isValidMediaUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url : null
  } catch {
    return null
  }
}

function subtitleFrom(entry: {
  url?: string
  lang?: string
  language?: string
  label?: string
}): Subtitle | null {
  const file = entry.url
  if (!file || !isValidMediaUrl(file)) return null
  return {
    file,
    label: entry.lang || entry.language || entry.label || 'Unknown',
    kind: 'captions',
  }
}

function linkFromEntry(
  serverName: string,
  entry: StreamEntry,
  index: number
): ProviderLink | null {
  const url = isValidMediaUrl(entry.url || '')
  if (!url) return null
  const isHls = inferStreamType(entry.type, url.href) === 'hls'
  return {
    server: `vidnest-${serverName}-${index + 1}`,
    url: url.href,
    isM3U8: isHls,
    isDASH: /\.mpd(?:$|[?#])/i.test(url.href),
    quality: normalizedQuality(entry.quality || entry.language),
    subtitles: [],
    headers: entry.headers || undefined,
    requiresProxy: false,
  }
}

// Maps the decrypted per-server response to ProviderLink[] + Subtitle[].
function mapServerResponse(
  serverName: string,
  root: unknown
): { links: ProviderLink[]; subtitles: Subtitle[] } {
  const links: ProviderLink[] = []
  let subtitles: Subtitle[] = []

  if (root && typeof root === 'object') {
    const record = root as Record<string, unknown>

    if (Array.isArray(record.streams)) {
      const entries = record.streams as StreamEntry[]
      const subtitlesPayload = record as SubtitleResponse
      subtitles = (subtitlesPayload.subtitles || [])
        .map(subtitleFrom)
        .filter((entry): entry is Subtitle => entry !== null)
      entries.forEach((entry, index) => {
        const link = linkFromEntry(serverName, entry, index)
        if (link) {
          link.subtitles = subtitles
          links.push(link)
        }
      })
    } else if (Array.isArray(record.sources)) {
      const entries = record.sources as StreamEntry[]
      entries.forEach((entry, index) => {
        const link = linkFromEntry(serverName, entry, index)
        if (link) links.push(link)
      })
    } else if (typeof record.url === 'string') {
      // videasy/nextgencloudfabric single-stream responses.
      const single = root as SingleUrlResponse
      const main = isValidMediaUrl(single.url || '')
      const candidates = [main, ...(single.all_urls || []).map(isValidMediaUrl)]
        .filter((value): value is URL => value !== null)
        .filter(
          (value, index, all) =>
            all.findIndex(other => other.href === value.href) === index
        )
      candidates.forEach((url, index) => {
        const isHls = /\.m3u8(?:$|[?#])/i.test(url.href)
        links.push({
          server: `vidnest-${serverName}${candidates.length > 1 ? `-${index + 1}` : ''}`,
          url: url.href,
          isM3U8: isHls,
          isDASH: /\.mpd(?:$|[?#])/i.test(url.href),
          quality: isHls ? 'auto' : normalizedQuality(single.label),
          subtitles: [],
          headers: single.headers || undefined,
          requiresProxy: false,
        })
      })
    } else if (record.data && typeof record.data === 'object') {
      // vidlink shape.
      const vidlink = root as VidlinkResponse
      const playlist = isValidMediaUrl(vidlink.data?.stream?.playlist || '')
      if (playlist) {
        subtitles = (vidlink.data?.stream?.captions || [])
          .map(subtitleFrom)
          .filter((entry): entry is Subtitle => entry !== null)
        links.push({
          server: `vidnest-${serverName}`,
          url: playlist.href,
          isM3U8:
            inferStreamType(vidlink.data?.stream?.type, playlist.href) ===
            'hls',
          isDASH: /\.mpd(?:$|[?#])/i.test(playlist.href),
          quality: 'auto',
          subtitles,
          headers: vidlink.headers || undefined,
          requiresProxy: false,
        })
      }
    } else if (Array.isArray(record.url)) {
      // moviebox shape.
      const moviebox = root as MovieBoxResponse
      ;(moviebox.url || []).forEach((entry, index) => {
        const url = isValidMediaUrl(entry.link || '')
        if (!url) return
        links.push({
          server: `vidnest-${serverName}-${entry.lang || 'default'}-${index + 1}`,
          url: url.href,
          isM3U8: /\.m3u8(?:$|[?#])/i.test(url.href),
          isDASH: /\.mpd(?:$|[?#])/i.test(url.href),
          quality: normalizedQuality(entry.resolution || entry.type),
          subtitles: [],
          headers: undefined,
          requiresProxy: false,
        })
      })
    }
  }
  return { links, subtitles }
}

async function fetchServer(
  server: VidNestServer,
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<{
  serverName: string
  links: ProviderLink[]
  subtitles: Subtitle[]
}> {
  const path =
    mediaType === 'movie'
      ? `${server.path}/movie/${tmdbId}`
      : `${server.path}/tv/${tmdbId}/${season}/${episode}`
  const response = await fetch(`${API_BASE_URL}/${path}`, {
    headers: API_HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} from ${new URL(response.url || API_BASE_URL).hostname} (${server.name})`
    )
  }
  const payload = (await response.json()) as {
    encrypted: boolean
    data: string
  }
  const root = decryptResponse<unknown>(payload)
  const mapped = mapServerResponse(server.name, root)
  console.log(
    `[VidNest] ${server.name}: ${mapped.links.length} candidate stream(s)`
  )
  return { serverName: server.name, ...mapped }
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
  const results = await Promise.allSettled(
    SERVERS.map(server =>
      fetchServer(server, tmdbId, mediaType, season, episode)
    )
  )
  const links: ProviderLink[] = []
  const subtitlesByLink = new Map<string, Subtitle[]>()
  results.forEach(result => {
    if (result.status !== 'fulfilled') {
      console.error(
        `[VidNest] ${result.reason instanceof Error ? result.reason.message : 'server failed'}`
      )
      return
    }
    const { links: serverLinks, subtitles } = result.value
    if (subtitles.length > 0) {
      for (const link of serverLinks) subtitlesByLink.set(link.url, subtitles)
    }
    links.push(...serverLinks)
  })
  const unique = Array.from(
    new Map(links.map(link => [link.url, link] as const)).values()
  )
  for (const link of unique) {
    if (link.subtitles.length === 0 && subtitlesByLink.has(link.url)) {
      link.subtitles = subtitlesByLink.get(link.url)!
    }
  }
  console.log(
    `[VidNest] Extracted ${unique.length} unique candidate stream(s) for ${mediaType} ${tmdbId}`
  )
  return unique
}

export const vidNestProvider: Provider = {
  name: 'VidNest',
  id: 'vidnest',
  alias: 'Wuchale',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
