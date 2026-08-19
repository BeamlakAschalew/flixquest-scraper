/* eslint-disable no-unused-vars */
import type { Provider, ProviderLink, Subtitle } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'

// Protocol and repair notes: ./AETHER_MAINTENANCE.md
const AETHER_ORIGIN = 'https://aether.bar'
const REQUEST_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'

// The workers reject requests that do not look like they originate from the
// Aether web application. A Chromium user agent alone is not enough; the
// Origin/Referer pair is required.
const REQUEST_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: AETHER_ORIGIN,
  Referer: `${AETHER_ORIGIN}/`,
  'User-Agent': USER_AGENT,
}

interface AetherSource {
  id: string
  name: string
  audio: string
  movieUrl: (tmdbId: string) => string
  tvUrl: (tmdbId: string, season: number, episode: number) => string
}

interface AetherSubtitle {
  file?: string
  url?: string
  label?: string
  language?: string
  lang?: string
  kind?: string
  type?: string
}

interface AetherStream {
  file?: string
  url?: string
  stream?: string
  source?: string
  name?: string
  label?: string
  server?: string
  quality?: string
  type?: string
  subtitles?: AetherSubtitle[]
  tracks?: AetherSubtitle[]
}

interface AetherPayload {
  file?: string
  url?: string
  stream?: string | AetherStream
  streams?: Array<string | AetherStream>
  sources?: Array<string | AetherStream>
  urls?: Array<string | AetherStream>
  subtitles?: AetherSubtitle[]
  tracks?: AetherSubtitle[]
}

function standardSource(
  id: string,
  name: string,
  audio: string,
  baseUrl: string
): AetherSource {
  return {
    id,
    name,
    audio,
    movieUrl: tmdbId => `${baseUrl}/movie/${encodeURIComponent(tmdbId)}`,
    tvUrl: (tmdbId, season, episode) =>
      `${baseUrl}/tv/${encodeURIComponent(tmdbId)}/${season}/${episode}`,
  }
}

// These workers currently return usable streams. Excluding the dead workers
// avoids a long tail of 404/5xx waits on every Aether request.
const SOURCES: AetherSource[] = [
  standardSource(
    'lul',
    'Lul 👾',
    'Original / English',
    'https://lul.aether.cx'
  ),
  standardSource(
    'link',
    'Link 🔗',
    'Original / English',
    'https://link.aether.cx'
  ),
  standardSource(
    'tiki',
    'Tiki 🗿',
    'Original / English',
    'https://tiki.aether.cx'
  ),
  standardSource(
    'vine',
    'Vine 🇩🇪',
    'Original / English',
    'https://vine.aether.cx'
  ),
]

function validHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return /^https?:$/.test(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function isBlockedStreamHost(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'tnmr.org' || hostname.endsWith('.tnmr.org')
  } catch {
    return true
  }
}

function formatSubtitles(entries: AetherSubtitle[] = []): Subtitle[] {
  return entries.flatMap(entry => {
    const file = validHttpUrl(entry.file || entry.url)
    if (!file) return []
    return [
      {
        file,
        label: entry.language || entry.lang || entry.label || 'Unknown',
        kind: entry.kind || entry.type || 'captions',
      },
    ]
  })
}

function streamEntries(payload: AetherPayload): AetherStream[] {
  const entries: Array<string | AetherStream> = []
  if (typeof payload.stream === 'string') entries.push(payload.stream)
  else if (payload.stream && typeof payload.stream === 'object') {
    entries.push(payload.stream)
  }
  if (payload.url) entries.push({ url: payload.url })
  if (payload.file) entries.push({ file: payload.file })
  if (Array.isArray(payload.streams)) entries.push(...payload.streams)
  if (Array.isArray(payload.sources)) entries.push(...payload.sources)
  if (Array.isArray(payload.urls)) entries.push(...payload.urls)
  return entries.map(entry =>
    typeof entry === 'string' ? { url: entry } : entry
  )
}

function parsePayload(
  source: AetherSource,
  payload: AetherPayload
): ProviderLink[] {
  const sharedSubtitles = formatSubtitles([
    ...(payload.subtitles || []),
    ...(payload.tracks || []),
  ])

  return streamEntries(payload).flatMap((entry, index) => {
    const url = validHttpUrl(
      entry.url || entry.file || entry.stream || entry.source
    )
    if (!url || isBlockedStreamHost(url)) return []

    const subtitles = [
      ...sharedSubtitles,
      ...formatSubtitles([...(entry.subtitles || []), ...(entry.tracks || [])]),
    ]
    const descriptor = entry.name || entry.label || entry.server
    if (/\batlas\b/i.test(descriptor || '')) return []
    const quality =
      entry.quality ||
      (descriptor && /\b(?:\d{3,4}p|4k|uhd|hd)\b/i.test(descriptor)
        ? descriptor
        : 'Auto')

    return [
      {
        server: `Aether | ${source.name} | ${source.audio}${descriptor ? ` | ${descriptor}` : ''} | ${index + 1}`,
        url,
        isM3U8:
          entry.type?.toLowerCase() !== 'mp4' ||
          /\.m3u8(?:$|[?#])/i.test(url) ||
          /\/m3u8-proxy(?:$|[?#])/i.test(url),
        quality,
        subtitles,
        headers: {
          Accept: '*/*',
          Origin: AETHER_ORIGIN,
          Referer: `${AETHER_ORIGIN}/`,
          'User-Agent': USER_AGENT,
        },
      } satisfies ProviderLink,
    ]
  })
}

async function fetchSource(
  source: AetherSource,
  url: string
): Promise<ProviderLink[]> {
  const response = await fetch(url, {
    headers: REQUEST_HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const text = await response.text()
  let payload: AetherPayload
  try {
    payload = JSON.parse(text) as AetherPayload
  } catch {
    throw new Error('Non-JSON response')
  }
  return parsePayload(source, payload)
}

async function getAetherStreams(
  createUrl: (source: AetherSource) => string
): Promise<ProviderLink[]> {
  const results = await Promise.allSettled(
    SOURCES.map(source => fetchSource(source, createUrl(source)))
  )

  const links: ProviderLink[] = []
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      links.push(...result.value)
      return
    }
    console.warn(
      `[Aether:${SOURCES[index].id}] ${result.reason instanceof Error ? result.reason.message : 'Source failed'}`
    )
  })

  const uniqueLinks = Array.from(
    new Map(links.map(link => [link.url, link])).values()
  )
  const allowedLinks = uniqueLinks.filter(
    link => !isBlockedStreamHost(link.url)
  )

  if (allowedLinks.length !== uniqueLinks.length) {
    console.warn(
      `[Aether] Dropped ${uniqueLinks.length - allowedLinks.length} blocked tnmr.org stream(s)`
    )
  }

  return allowedLinks
}

export const aetherProvider: Provider = {
  name: 'Aether',
  id: 'aether',
  alias: 'Axum',
  streamMovie: tmdbId => getAetherStreams(source => source.movieUrl(tmdbId)),
  streamTV: (tmdbId, season, episode) =>
    getAetherStreams(source => source.tvUrl(tmdbId, season, episode)),
}
