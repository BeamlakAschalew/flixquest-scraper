/* eslint-disable no-unused-vars */
import type { Provider, ProviderLink, Subtitle } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'

const API_BASE = 'https://api.shegu.st'
const ORIGIN = 'https://cinejoy.to'
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
const REQUEST_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS
const GATEWAY_DISCOVERY_ATTEMPTS = 2
const WATCH_ROUTES = ['/watch/movie/[id]', '/watch/tv/[id]/[season]/[episode]']

interface CinejoyServer {
  name: string
  status?: string
  '4k'?: boolean
}

interface CinejoySubtitle {
  id?: string
  type?: string
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
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  return response.text()
}

function findAppEntry(page: string): string {
  const asset = page.match(
    /["'](\/_app\/immutable\/entry\/app\.[^"'?]+\.js(?:\?[^"']*)?)["']/
  )?.[1]
  if (!asset) throw new Error('Cinejoy app entry was not found')
  return new URL(asset, ORIGIN).href
}

function findWatchNodeUrls(app: string): string[] {
  const nodeIndexes = WATCH_ROUTES.flatMap(route => {
    const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = app.match(new RegExp(`"${escapedRoute}":\\[(\\d+)\\]`))
    return match ? [match[1]] : []
  })

  const nodeAssets = new Map(
    Array.from(
      app.matchAll(/(?:\.\.\/|\/)nodes\/(\d+)\.([^"']+\.js)/g),
      match => [match[1], match[0]] as const
    )
  )
  const urls = nodeIndexes.flatMap(index => {
    const asset = nodeAssets.get(index)
    return asset ? [new URL(asset, `${ORIGIN}/_app/immutable/entry/`).href] : []
  })
  if (!urls.length) throw new Error('Cinejoy watch route nodes were not found')
  return [...new Set(urls)]
}

function findImportedChunkUrls(nodes: string[]): string[] {
  const assets = nodes.flatMap(node =>
    Array.from(
      node.matchAll(/["'](\.\.\/chunks\/[^"']+\.js)["']/g),
      match => match[1]
    )
  )
  const urls = assets.map(
    asset => new URL(asset, `${ORIGIN}/_app/immutable/nodes/`).href
  )
  if (!urls.length) throw new Error('Cinejoy watch route chunks were not found')
  return [...new Set(urls)]
}

function hasGatewayExports(source: string): boolean {
  const exportBlocks = Array.from(
    source.matchAll(/export\{([^}]+)\}/g),
    match => match[1]
  )
  return exportBlocks.some(block =>
    ['d', 'n', 'o'].every(name =>
      new RegExp(
        `(?:^|,)\\s*(?:[A-Za-z_$][\\w$]*\\s+as\\s+)?${name}\\s*(?=,|$)`
      ).test(block)
    )
  )
}

function makeGatewayStandalone(source: string): string {
  const settingsImport =
    /import\s*\{\s*[ap]\s+as\s+([A-Za-z_$][\w$]*)\s*\}\s*from\s*["']\.\/[^"']+["'];?/
  const match = source.match(settingsImport)
  if (!match) throw new Error('Cinejoy gateway import signature changed')
  return source.replace(settingsImport, `const ${match[1]}=[];`)
}

async function discoverGatewaySource(cacheBust = false): Promise<string> {
  const watchUrl = new URL(`${ORIGIN}/watch/movie/1081003`)
  if (cacheBust) watchUrl.searchParams.set('_build', Date.now().toString())

  const page = await fetchText(watchUrl.href)
  const app = await fetchText(findAppEntry(page))
  const nodeUrls = findWatchNodeUrls(app)
  const nodes = await Promise.all(nodeUrls.map(fetchText))
  const chunkUrls = findImportedChunkUrls(nodes)
  const chunks = await Promise.allSettled(chunkUrls.map(fetchText))

  for (const result of chunks) {
    if (result.status === 'fulfilled' && hasGatewayExports(result.value)) {
      try {
        makeGatewayStandalone(result.value)
        return result.value
      } catch {
        // Other shared chunks can coincidentally expose the same minified
        // names; the gateway also has the removable settings-store import.
      }
    }
  }
  throw new Error('Cinejoy gateway chunk was not found in watch route imports')
}

async function importGateway(source: string): Promise<CinejoyGateway> {
  // The gateway's only import is the settings store. Stream lookups do not
  // use it, so removing that browser-only dependency makes Cinejoy's own
  // encrypted gateway client executable in Node without reimplementing its
  // frequently changing handshake protocol.
  const standalone = makeGatewayStandalone(source)
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
}

async function loadGateway(): Promise<CinejoyGateway> {
  if (gatewayPromise) return gatewayPromise
  gatewayPromise = (async () => {
    let lastError: unknown
    for (let attempt = 0; attempt < GATEWAY_DISCOVERY_ATTEMPTS; attempt++) {
      try {
        return await importGateway(await discoverGatewaySource(attempt > 0))
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
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

function subtitleLabel(caption: CinejoySubtitle): string {
  const id = caption.id?.trim()
  if (id) {
    const descriptive = id.replace(/^[a-z]{2,3}[-_]/i, '')
    return descriptive.replace(/\b\w/g, character => character.toUpperCase())
  }

  const language = caption.language || caption.lang
  if (!language) return 'Unknown'
  try {
    return (
      new Intl.DisplayNames(['en'], { type: 'language' }).of(language) ||
      language
    )
  } catch {
    return language
  }
}

function subtitlesFor(stream: CinejoyStream): Subtitle[] {
  return Array.from(
    new Map(
      (stream.captions || []).flatMap(caption => {
        if (!caption.url || !/^https?:\/\//i.test(caption.url)) return []
        const label = subtitleLabel(caption)
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

function mergeSubtitles(...groups: Subtitle[][]): Subtitle[] {
  return Array.from(
    new Map(
      groups
        .flat()
        .map(
          subtitle => [`${subtitle.file}|${subtitle.label}`, subtitle] as const
        )
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
    // Captions are returned by the server that sourced them. Make the full
    // Cinejoy subtitle catalog available on every equivalent playback link,
    // including servers whose stream response has no captions of its own.
    const allSubtitles = mergeSubtitles(...links.map(link => link.subtitles))
    const uniqueLinks = Array.from(
      new Map(
        links.map(link => [
          link.url,
          { ...link, subtitles: mergeSubtitles(link.subtitles, allSubtitles) },
        ])
      ).values()
    )
    return uniqueLinks.sort(
      (a, b) => qualityScore(b.quality) - qualityScore(a.quality)
    )
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
  alias: 'Shewa',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
