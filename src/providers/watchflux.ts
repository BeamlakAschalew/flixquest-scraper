import type { Provider, ProviderLink, Subtitle } from '../types/index.js'

const WATCHFLUX_ORIGIN = 'https://watchflux.tv'
const REQUEST_TIMEOUT_MS = 20_000

interface WatchFluxSource {
  service?: string
  url?: string
  type?: string
}

interface WatchFluxSubtitle {
  url?: string
  file?: string
  label?: string
  language?: string
  lang?: string
}

interface WatchFluxMedia {
  sources?: WatchFluxSource[]
  subtitles?: WatchFluxSubtitle[]
}

function configuredClearance(): string {
  let value = process.env.WATCHFLUX_CF_CLEARANCE?.trim() || ''
  if (value.startsWith('cf_clearance=')) value = value.slice(13)
  if (!value) throw new Error('WATCHFLUX_CF_CLEARANCE is not configured')
  if (/[\r\n;]/.test(value)) {
    throw new Error('WATCHFLUX_CF_CLEARANCE has an invalid format')
  }
  return value
}

function configuredUserAgent(): string {
  const value = process.env.WATCHFLUX_USER_AGENT?.trim() || ''
  if (!value) throw new Error('WATCHFLUX_USER_AGENT is not configured')
  if (/[\r\n]/.test(value)) {
    throw new Error('WATCHFLUX_USER_AGENT has an invalid format')
  }
  return value
}

function parseEncodedVariable(html: string, name: string): unknown {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = html.match(
    new RegExp(`(?:let|const|var)\\s+${escapedName}="([^"]+)"`)
  )
  if (!match) return undefined
  return JSON.parse(decodeURIComponent(match[1]))
}

function parsePlayerData(html: string): WatchFluxMedia {
  const fullMedia = parseEncodedVariable(html, 'fullMediaStr')
  const sources = parseEncodedVariable(html, 'sourcesStr')
  const media =
    fullMedia && typeof fullMedia === 'object'
      ? (fullMedia as WatchFluxMedia)
      : {}

  if (Array.isArray(sources)) media.sources = sources as WatchFluxSource[]
  return media
}

function formatSubtitles(entries: WatchFluxSubtitle[] = []): Subtitle[] {
  return entries.flatMap(entry => {
    const file = entry.url || entry.file
    if (!file || !/^https?:\/\//i.test(file)) return []
    return [
      {
        file,
        label: entry.language || entry.lang || entry.label || 'Unknown',
        kind: 'captions',
      },
    ]
  })
}

async function fetchWatchPage(path: string): Promise<WatchFluxMedia> {
  const response = await fetch(`${WATCHFLUX_ORIGIN}${path}`, {
    headers: {
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Cookie: `cf_clearance=${configuredClearance()}`,
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Upgrade-Insecure-Requests': '1',
      'User-Agent': configuredUserAgent(),
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const html = await response.text()
  if (
    !response.ok ||
    response.headers.get('cf-mitigated') === 'challenge' ||
    /<title>\s*Just a moment/i.test(html)
  ) {
    throw new Error(
      `WatchFlux clearance was rejected (HTTP ${response.status}); refresh WATCHFLUX_CF_CLEARANCE and ensure WATCHFLUX_USER_AGENT matches its browser`
    )
  }
  return parsePlayerData(html)
}

async function getWatchFluxStreams(path: string): Promise<ProviderLink[]> {
  try {
    const media = await fetchWatchPage(path)
    const subtitles = formatSubtitles(media.subtitles)
    const playbackHeaders = {
      Accept: '*/*',
      Origin: WATCHFLUX_ORIGIN,
      Referer: `${WATCHFLUX_ORIGIN}/`,
      'User-Agent': configuredUserAgent(),
    }

    return (media.sources || []).flatMap((source, index) => {
      if (!source.url) return []
      try {
        const url = new URL(source.url)
        if (!['http:', 'https:'].includes(url.protocol)) return []
        return [
          {
            server: `WatchFlux | ${source.service || 'Server'} | ${index + 1}`,
            url: url.href,
            isM3U8:
              source.type?.toLowerCase() !== 'mp4' ||
              /\.m3u8(?:$|[?#])/i.test(url.href),
            quality: '720p',
            subtitles,
            headers: playbackHeaders,
            requiresProxy: true,
          } satisfies ProviderLink,
        ]
      } catch {
        return []
      }
    })
  } catch (error) {
    console.error(
      `[WatchFlux] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const watchFluxProvider: Provider = {
  name: 'WatchFlux',
  id: 'watchflux',
  streamMovie: tmdbId =>
    getWatchFluxStreams(`/watch/movie/${encodeURIComponent(tmdbId)}`),
  streamTV: (tmdbId, season, episode) =>
    getWatchFluxStreams(
      `/watch/tv/${encodeURIComponent(tmdbId)}/season/${season}/episode/${episode}`
    ),
}
