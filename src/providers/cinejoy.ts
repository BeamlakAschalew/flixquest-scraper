/* eslint-disable no-unused-vars */
import type { Provider, ProviderLink, Subtitle } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'

const API_BASE = 'https://api.shegu.st'
const ORIGIN = 'https://cinejoy.to'
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
const REQUEST_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS
const FALLBACK_GATEWAY_CHUNK = 'BOqDcafn.js'

interface CinejoyServer {
  name: string
  status?: string
  '4k'?: boolean
}

interface CinejoySubtitle {
  url?: string
  language?: string
  lang?: string
}

interface CinejoyStream {
  type?: string
  id?: string
  playlist?: string
  url?: string
  qualities?: Record<string, { type?: string; url?: string }>
  captions?: CinejoySubtitle[]
}

interface CinejoyResponse {
  stream?: CinejoyStream[]
}

interface CinejoyGateway {
  d: () => Promise<CinejoyServer[]>
  n: (
    server: string,
    tmdbId: string,
    title?: string,
    year?: string,
    imdbId?: string
  ) => Promise<CinejoyResponse>
  o: (
    server: string,
    tmdbId: string,
    season: number,
    episode: number,
    title?: string,
    year?: string,
    imdbId?: string
  ) => Promise<CinejoyResponse>
}

const FALLBACK_SERVERS: CinejoyServer[] = [
  { name: 'Lisbon', '4k': true },
  { name: 'Solara' },
  { name: 'Athens' },
  { name: 'Joy' },
  { name: 'Castle' },
  { name: 'Sakura' },
  { name: 'Canaias' },
]

const API_HEADERS = {
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: ORIGIN,
  Referer: `${ORIGIN}/`,
  'User-Agent': USER_AGENT,
}

let gatewayPromise: Promise<CinejoyGateway> | null = null

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: API_HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  return response.text()
}

function findGatewayChunk(page: string): string {
  return (
    page.match(/\/_app\/immutable\/chunks\/(BOq[^"']+\.js)/)?.[1] ||
    FALLBACK_GATEWAY_CHUNK
  )
}

async function loadGateway(): Promise<CinejoyGateway> {
  if (gatewayPromise) return gatewayPromise
  gatewayPromise = (async () => {
    const page = await fetchText(`${ORIGIN}/watch/movie/1081003`)
    const chunkName = findGatewayChunk(page)
    const source = await fetchText(
      `${ORIGIN}/_app/immutable/chunks/${chunkName}`
    )

    // The gateway's only import is the settings store. Stream lookups do not
    // use it, so removing that browser-only dependency makes Cinejoy's own
    // encrypted gateway client executable in Node without reimplementing its
    // frequently changing handshake protocol.
    const standalone = source.replace(
      /import\{a as X\}from["']\.\/[^"']+["'];?/,
      'const X=[];'
    )
    if (standalone === source) {
      throw new Error('Cinejoy gateway import signature changed')
    }

    const moduleUrl = `data:text/javascript;base64,${Buffer.from(standalone).toString('base64')}`
    const gateway = (await import(moduleUrl)) as Partial<CinejoyGateway>
    if (
      typeof gateway.d !== 'function' ||
      typeof gateway.n !== 'function' ||
      typeof gateway.o !== 'function'
    ) {
      throw new Error('Cinejoy gateway exports changed')
    }
    return gateway as CinejoyGateway
  })().catch(error => {
    gatewayPromise = null
    throw error
  })
  return gatewayPromise
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Cinejoy gateway timed out')),
          REQUEST_TIMEOUT_MS
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function normalizeQuality(value: string): string {
  if (/2160|4k/i.test(value)) return '2160p'
  if (/1440/i.test(value)) return '1440p'
  if (/1080/i.test(value)) return '1080p'
  if (/720/i.test(value)) return '720p'
  if (/480/i.test(value)) return '480p'
  if (/360/i.test(value)) return '360p'
  return value || 'Auto'
}

function subtitlesFor(stream: CinejoyStream): Subtitle[] {
  return Array.from(
    new Map(
      (stream.captions || []).flatMap(caption => {
        if (!caption.url || !/^https?:\/\//i.test(caption.url)) return []
        const label = caption.language || caption.lang || 'Unknown'
        return [
          [
            `${caption.url}|${label}`,
            { file: caption.url, label, kind: 'captions' } satisfies Subtitle,
          ] as const,
        ]
      })
    ).values()
  )
}

function formatStream(
  server: CinejoyServer,
  stream: CinejoyStream,
  quality?: string,
  url?: string,
  subtitles?: Subtitle[]
): ProviderLink | null {
  if (!url || !/^https?:\/\//i.test(url)) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const isM3U8 = /\.m3u8(?:$|[?#])/i.test(parsed.href) || stream.type === 'hls'
  const isDASH = /\.mpd(?:$|[?#])/i.test(parsed.href) || stream.type === 'dash'
  return {
    server: `Cinejoy | ${server.name}${quality ? ` | ${quality}` : ''}`,
    url: parsed.href,
    isM3U8,
    isDASH,
    quality: normalizeQuality(quality || ''),
    subtitles: subtitles || [],
    headers: isM3U8 || isDASH ? API_HEADERS : undefined,
    requiresProxy: isM3U8 || isDASH,
  }
}

function formatResponse(
  server: CinejoyServer,
  response: CinejoyResponse
): ProviderLink[] {
  const links: ProviderLink[] = []
  for (const stream of response.stream || []) {
    const subtitles = subtitlesFor(stream)
    if (stream.playlist) {
      const link = formatStream(
        server,
        stream,
        'Auto',
        stream.playlist,
        subtitles
      )
      if (link) links.push(link)
    }
    if (stream.url) {
      const link = formatStream(
        server,
        stream,
        stream.id,
        stream.url,
        subtitles
      )
      if (link) links.push(link)
    }
    for (const [quality, variant] of Object.entries(stream.qualities || {})) {
      const link = formatStream(server, stream, quality, variant.url, subtitles)
      if (link) links.push(link)
    }
  }
  return links
}

async function fetchServers(): Promise<CinejoyServer[]> {
  try {
    const gateway = await loadGateway()
    const servers = (await withTimeout(gateway.d())).filter(
      server => server.name && server.status !== 'down'
    )
    return servers.length ? servers : FALLBACK_SERVERS
  } catch {
    try {
      const response = await fetch(`${API_BASE}/servers`, {
        headers: API_HEADERS,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) return FALLBACK_SERVERS
      const data = (await response.json()) as { servers?: CinejoyServer[] }
      const servers = (data.servers || []).filter(server => server.name)
      return servers.length ? servers : FALLBACK_SERVERS
    } catch {
      return FALLBACK_SERVERS
    }
  }
}

async function fetchServer(
  server: CinejoyServer,
  mediaType: 'movie' | 'tv',
  tmdbId: string,
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  const gateway = await loadGateway()
  const response =
    mediaType === 'movie'
      ? await withTimeout(gateway.n(server.name, tmdbId))
      : await withTimeout(gateway.o(server.name, tmdbId, season!, episode!))
  return formatResponse(server, response)
}

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  if (!/^\d+$/.test(tmdbId)) return []
  if (
    mediaType === 'tv' &&
    (!Number.isInteger(season) ||
      !Number.isInteger(episode) ||
      season! < 1 ||
      episode! < 1)
  )
    return []

  try {
    const servers = await fetchServers()
    const settled = await Promise.allSettled(
      servers.map(server =>
        fetchServer(server, mediaType, tmdbId, season, episode)
      )
    )
    settled.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn(
          `[Cinejoy] ${servers[index].name} failed: ${
            result.reason instanceof Error
              ? result.reason.message
              : 'Unknown error'
          }`
        )
      }
    })
    const links = settled.flatMap(result =>
      result.status === 'fulfilled' ? result.value : []
    )
    return Array.from(
      new Map(links.map(link => [link.url, link])).values()
    ).sort((a, b) => qualityScore(b.quality) - qualityScore(a.quality))
  } catch (error) {
    console.error(
      `[Cinejoy] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

function qualityScore(quality: string): number {
  if (/auto/i.test(quality)) return 4000
  return Number(quality.match(/\d{3,4}/)?.[0] || 0)
}

export const cinejoyProvider: Provider = {
  name: 'Cinejoy',
  id: 'cinejoy',
  alias: 'Cinejoy',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
