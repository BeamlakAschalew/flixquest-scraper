import type { Provider, ProviderLink, Subtitle } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'
import {
  isPlayerApiUrl,
  openServerStream,
  resolveServers,
} from './vidfast-runtime.js'

const BASE_URL = 'https://vidfast.vc'
const REQUEST_TIMEOUT_MS = Math.max(20_000, DEFAULT_REQUEST_TIMEOUT_MS)
const RESOLVE_TIMEOUT_MS = 60_000
const CSRF_TOKEN = '0qv1jDQw6mHsiQm7fDjrWm1VNq9sqm2a'
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

interface VidFastPlayerProps {
  en: string
  host: string
  title?: string
  year?: string
  server?: string | null
  [key: string]: unknown
}

interface VidFastServer {
  data?: string
  name?: string
  description?: string
  selected?: boolean
}

interface VidFastTrack {
  file?: string
  url?: string
  label?: string
  language?: string
  kind?: string
}

interface VidFastStream {
  url?: string
  mp4?: boolean
  noReferrer?: boolean
  '4kAvailable'?: boolean
  tracks?: VidFastTrack[]
}

interface PlayerPage {
  props: VidFastPlayerProps
  referer: string
  cookies: Map<string, string>
}

let runtimeQueue: Promise<void> = Promise.resolve()

function isValidTmdbId(value: string): boolean {
  return /^\d+$/.test(value)
}

function isValidEpisodeNumber(value: number | undefined): value is number {
  return Number.isInteger(value) && Number(value) > 0
}

function parseSetCookies(response: Response, cookies: Map<string, string>) {
  const values =
    response.headers.getSetCookie?.() ||
    (response.headers.get('set-cookie')
      ? [response.headers.get('set-cookie')!]
      : [])

  for (const value of values) {
    for (const part of value.split(/,(?=\s*[^;,]+=[^;,]+)/)) {
      const pair = part.split(';', 1)[0].trim()
      const separator = pair.indexOf('=')
      if (separator > 0) {
        cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
      }
    }
  }
}

function requestHeaders(
  referer: string,
  initHeaders?: HeadersInit,
  cookies?: Map<string, string>
): Headers {
  const headers = new Headers(initHeaders)
  if (!headers.has('Accept')) headers.set('Accept', '*/*')
  if (!headers.has('User-Agent')) headers.set('User-Agent', USER_AGENT)
  headers.set('Referer', referer)
  headers.set('Origin', BASE_URL)

  if (cookies?.size) {
    headers.set(
      'Cookie',
      [...cookies.entries()]
        .map(([name, value]) => `${name}=${value}`)
        .join('; ')
    )
  }
  return headers
}

function parsePlayerProps(html: string): VidFastPlayerProps {
  const tokenMatch = html.match(/\\"en\\":\\"([^\\"]+)\\"/)
  if (!tokenMatch?.[0]) throw new Error('session token not found')

  const start = html.indexOf(tokenMatch[0])
  const chunk = html.slice(start, start + 2_500)
  const end = chunk.match(/\\"server\\":(?:\\"[^\\"]*\\"|null)\}/)
  if (!end || end.index === undefined) {
    throw new Error('player properties are incomplete')
  }

  const raw = `{${html.slice(start, start + end.index + end[0].length - 1)}}`
  const normalized = raw.replace(/\\"/g, '"').replace(/"\$undefined"/g, 'null')
  const props = JSON.parse(normalized) as VidFastPlayerProps
  if (!props.en || !props.host) throw new Error('player properties are invalid')
  return props
}

async function fetchPlayerPage(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<PlayerPage> {
  const path =
    mediaType === 'movie'
      ? `/movie/${encodeURIComponent(tmdbId)}`
      : `/tv/${encodeURIComponent(tmdbId)}/${season}/${episode}`
  const referer = `${BASE_URL}${path}`
  const cookies = new Map<string, string>()
  const response = await fetch(referer, {
    headers: requestHeaders(`${BASE_URL}/`, {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok)
    throw new Error(`page request returned HTTP ${response.status}`)
  parseSetCookies(response, cookies)
  return { props: parsePlayerProps(await response.text()), referer, cookies }
}

function createPlayerFetch(page: PlayerPage) {
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const rawUrl = String(input)
    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `${BASE_URL}${rawUrl}`
    const headers = requestHeaders(page.referer, init.headers, page.cookies)
    if (isPlayerApiUrl(url)) {
      headers.set('X-CSRF-Token', CSRF_TOKEN)
      headers.set('X-Requested-With', 'XMLHttpRequest')
    }

    const response = await fetch(url, {
      ...init,
      headers,
      signal: init.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    parseSetCookies(response, page.cookies)
    return response
  }
}

function validMediaUrl(value: string | undefined): URL | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    return /^https?:$/.test(parsed.protocol) ? parsed : null
  } catch {
    return null
  }
}

function subtitlesFrom(stream: VidFastStream): Subtitle[] {
  return (stream.tracks || []).flatMap(track => {
    const parsed = validMediaUrl(track.file || track.url)
    if (!parsed) return []
    return [
      {
        file: parsed.href,
        label: track.label || track.language || 'Unknown',
        kind: track.kind || 'captions',
      },
    ]
  })
}

function qualityFrom(
  streamUrl: string,
  server: VidFastServer,
  stream: VidFastStream
): string {
  const explicit = streamUrl.match(
    /(?:^|[-_/])s?(2160|1440|1080|720|480)p(?:[-_.?/]|$)/i
  )
  if (explicit) return `${explicit[1]}p`
  if (/\.m3u8(?:$|[?#])/i.test(streamUrl)) return 'auto'
  if (stream['4kAvailable'] || /(?:4k|2160)/i.test(server.description || '')) {
    return '2160p'
  }
  return '1080p'
}

async function resolveServer(
  server: VidFastServer,
  playerFetch: ReturnType<typeof createPlayerFetch>,
  playerContext: Record<string, unknown>
): Promise<ProviderLink[]> {
  if (!server.data) return []
  const stream = (await openServerStream(
    server,
    playerFetch,
    playerContext
  )) as VidFastStream
  const parsed = validMediaUrl(stream.url)
  if (!parsed) return []

  const isM3U8 = /\.m3u8(?:$|[?#])/i.test(parsed.href)
  const isDASH = /\.mpd(?:$|[?#])/i.test(parsed.href)
  const headers: Record<string, string> = stream.noReferrer
    ? { Accept: '*/*', 'User-Agent': USER_AGENT }
    : {
        Accept: '*/*',
        Referer: `${BASE_URL}/`,
        Origin: BASE_URL,
        'User-Agent': USER_AGENT,
      }

  return [
    {
      server: `vidfast-${server.name || 'default'}`,
      url: parsed.href,
      isM3U8,
      isDASH,
      quality: qualityFrom(parsed.href, server, stream),
      subtitles: subtitlesFrom(stream),
      headers,
      requiresProxy: !stream.noReferrer,
    },
  ]
}

async function resolvePage(page: PlayerPage, tmdbId: string) {
  const playerFetch = createPlayerFetch(page)
  const resolved = await resolveServers(page.props.en, {
    props: page.props,
    id: tmdbId,
    referer: page.referer,
    fetch: playerFetch,
  })
  const servers = resolved.servers.at(-1) as VidFastServer[] | undefined
  if (!servers?.length) throw new Error('server list is empty')

  const settled = await Promise.allSettled(
    servers
      .filter(server => server.data)
      .map(server =>
        resolveServer(
          server,
          playerFetch,
          resolved.playerContext as Record<string, unknown>
        )
      )
  )
  return settled.flatMap(result =>
    result.status === 'fulfilled' ? result.value : []
  )
}

async function withRuntimeLock<T>(task: () => Promise<T>): Promise<T> {
  const previous = runtimeQueue
  let release = () => {}
  runtimeQueue = new Promise<void>(resolve => {
    release = resolve
  })
  await previous
  try {
    return await task()
  } finally {
    release()
  }
}

async function withResolveTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('resolution timed out')),
          RESOLVE_TIMEOUT_MS
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
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
    (!isValidEpisodeNumber(season) || !isValidEpisodeNumber(episode))
  ) {
    return []
  }

  try {
    return await withRuntimeLock(async () => {
      const page = await fetchPlayerPage(tmdbId, mediaType, season, episode)
      const links = await withResolveTimeout(resolvePage(page, tmdbId))
      console.log(`[VidFast] Extracted ${links.length} candidate stream(s)`)
      return links
    })
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
