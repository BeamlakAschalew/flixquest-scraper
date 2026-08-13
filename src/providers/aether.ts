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

const ALL_SOURCES: AetherSource[] = [
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
  {
    ...standardSource(
      'nebula',
      'Nebula 🌌',
      'Original / English',
      'https://nebula.aether.cx'
    ),
    movieUrl: tmdbId =>
      `https://nebula.aether.cx/movie/${encodeURIComponent(tmdbId)}?ser=cf`,
    tvUrl: (tmdbId, season, episode) =>
      `https://nebula.aether.cx/tv/${encodeURIComponent(tmdbId)}/${season}/${episode}?ser=cf`,
  },
  {
    id: 'meridian',
    name: 'Meridian 🪐',
    audio: 'Original / English',
    movieUrl: tmdbId =>
      `https://meridian.aether.bar/movie/${encodeURIComponent(tmdbId)}`,
    tvUrl: (tmdbId, season, episode) =>
      `https://meridian.aether.bar/show/${encodeURIComponent(tmdbId)}/${season}/${episode}`,
  },
  standardSource(
    'tiki',
    'Tiki 🗿',
    'Original / English',
    'https://tiki.aether.cx'
  ),
  standardSource(
    'vidy',
    'Vidy 📺',
    'Original / English',
    'https://vidy.aether.cx'
  ),
  standardSource(
    'vine',
    'Vine 🇩🇪',
    'Original / English',
    'https://vine.aether.cx'
  ),
  {
    id: 'fast',
    name: 'Fast ⚡',
    audio: 'Original / English',
    movieUrl: tmdbId =>
      `https://fast.aether.cx/scrape?type=movie&tmdbId=${encodeURIComponent(tmdbId)}`,
    tvUrl: (tmdbId, season, episode) =>
      `https://fast.aether.cx/scrape?type=show&tmdbId=${encodeURIComponent(tmdbId)}&season=${season}&episode=${episode}`,
  },
  {
    ...standardSource(
      'subtitulado',
      'Subtitulado 🇪🇸',
      'Original audio, Spanish subtitles',
      'https://sol.aether.bar'
    ),
    movieUrl: tmdbId =>
      `https://sol.aether.bar/movie/${encodeURIComponent(tmdbId)}?lang=sub`,
    tvUrl: (tmdbId, season, episode) =>
      `https://sol.aether.bar/tv/${encodeURIComponent(tmdbId)}/${season}/${episode}?lang=sub`,
  },
  {
    ...standardSource(
      'latino',
      'Latino 🇲🇽',
      'Latin-American Spanish',
      'https://sol.aether.bar'
    ),
    movieUrl: tmdbId =>
      `https://sol.aether.bar/movie/${encodeURIComponent(tmdbId)}?lang=lat`,
    tvUrl: (tmdbId, season, episode) =>
      `https://sol.aether.bar/tv/${encodeURIComponent(tmdbId)}/${season}/${episode}?lang=lat`,
  },
  {
    ...standardSource(
      'castellano',
      'Castellano 🇪🇸',
      'Castilian Spanish',
      'https://sol.aether.bar'
    ),
    movieUrl: tmdbId =>
      `https://sol.aether.bar/movie/${encodeURIComponent(tmdbId)}?lang=esp`,
    tvUrl: (tmdbId, season, episode) =>
      `https://sol.aether.bar/tv/${encodeURIComponent(tmdbId)}/${season}/${episode}?lang=esp`,
  },
  standardSource('cowflix', 'Cowflix 🇩🇪', 'German', 'https://cow.aether.bar'),
  {
    id: 'gallic',
    name: 'Gallic 🇫🇷',
    audio: 'French',
    movieUrl: tmdbId =>
      `https://baguette.aether.cx/api/movie/${encodeURIComponent(tmdbId)}`,
    tvUrl: (tmdbId, season, episode) =>
      `https://baguette.aether.cx/api/tv/${encodeURIComponent(tmdbId)}?s=${season}&e=${episode}`,
  },
]

const SOURCES = ALL_SOURCES

function validHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return /^https?:$/.test(url.protocol) ? url.href : null
  } catch {
    return null
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
    if (!url) return []

    const subtitles = [
      ...sharedSubtitles,
      ...formatSubtitles([...(entry.subtitles || []), ...(entry.tracks || [])]),
    ]
    const descriptor = entry.name || entry.label || entry.server
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

  return Array.from(new Map(links.map(link => [link.url, link])).values())
}

export const aetherProvider: Provider = {
  name: 'Aether',
  id: 'aether',
  alias: 'Axum',
  streamMovie: tmdbId => getAetherStreams(source => source.movieUrl(tmdbId)),
  streamTV: (tmdbId, season, episode) =>
    getAetherStreams(source => source.tvUrl(tmdbId, season, episode)),
}
