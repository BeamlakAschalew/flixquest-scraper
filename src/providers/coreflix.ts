import type { Provider, ProviderLink, Subtitle } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'
import { withForcedForwardProxy } from '../utils/forward-proxy.js'
import {
  decryptVidCorePayload,
  resolveVidCoreServers,
  type VidCoreBundleConfig,
  type VidCoreServer,
} from './coreflix-vidcore-runtime.js'

const COREFLIX_ORIGIN = 'https://coreflix.tv'
const VIDCORE_EMBED_ORIGIN = 'https://vidcore.net'
const VIDCORE_ORIGINS = new Set(['https://vidcore.net', 'https://vidcore.io'])
const REQUEST_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'

const PAGE_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: `${COREFLIX_ORIGIN}/`,
  'User-Agent': USER_AGENT,
}

interface BundleArtifact {
  url: string
  source: string
}

interface VidCoreTrack {
  file?: string
  url?: string
  src?: string
  label?: string
  language?: string
  lang?: string
  kind?: string
}

interface VidCoreSourcePayload {
  url?: string
  type?: string
  quality?: string
  noReferrer?: boolean
  headers?: Record<string, string>
  tracks?: VidCoreTrack[]
  subtitles?: VidCoreTrack[]
  '4kAvailable'?: boolean
}

let bundleArtifactPromise: Promise<BundleArtifact> | undefined

function validHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return /^https?:$/.test(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function normalizeQuality(value?: string): string {
  const quality = String(value || '').trim()
  if (/2160|4k|uhd/i.test(quality)) return '2160p'
  if (/1440|2k|qhd/i.test(quality)) return '1440p'
  if (/1080|full\s*hd/i.test(quality)) return '1080p'
  if (/720|\bhd\b/i.test(quality)) return '720p'
  if (/480|\bsd\b/i.test(quality)) return '480p'
  if (/360/i.test(quality)) return '360p'
  return 'Auto'
}

function extractEnToken(html: string): string {
  const escaped = html.match(/\\"en\\":\\"([^\\"]+)/)?.[1]
  const plain = html.match(/"en":"([^"]+)/)?.[1]
  const token = escaped || plain
  if (!token) throw new Error('VidCore page did not contain a player token')
  return token
}

function scriptUrls(html: string, pageUrl: string): string[] {
  const urls = [...html.matchAll(/<script[^>]+src=["']([^"']+)/gi)]
    .flatMap(match => {
      try {
        const url = new URL(match[1], pageUrl)
        return VIDCORE_ORIGINS.has(url.origin) && url.pathname.endsWith('.js')
          ? [url.href]
          : []
      } catch {
        return []
      }
    })
    .filter((url, index, all) => all.indexOf(url) === index)

  return urls.sort((left, right) => {
    const score = (url: string): number => {
      if (/\/chunks\/281-/i.test(url)) return 0
      if (/\/chunks\/\d+-/i.test(url)) return 1
      return 2
    }
    return score(left) - score(right)
  })
}

async function loadBundle(
  html: string,
  pageUrl: string
): Promise<BundleArtifact> {
  if (bundleArtifactPromise) return bundleArtifactPromise

  bundleArtifactPromise = (async () => {
    for (const url of scriptUrls(html, pageUrl)) {
      const response = await fetch(url, {
        headers: { ...PAGE_HEADERS, Referer: pageUrl },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) continue
      const source = await response.text()
      const legacyProtocol =
        source.includes('function sh(') && source.includes('var cT=o(')
      const currentProtocol =
        source.includes('function sA(') && source.includes('function iV(')
      if (!legacyProtocol && !currentProtocol) {
        continue
      }
      return { url, source }
    }
    throw new Error('VidCore player bundle could not be located')
  })()

  try {
    return await bundleArtifactPromise
  } catch (error) {
    bundleArtifactPromise = undefined
    throw error
  }
}

function buildPageUrl(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season: number,
  episode: number
): string {
  const path =
    mediaType === 'movie'
      ? `/movie/${encodeURIComponent(tmdbId)}`
      : `/tv/${encodeURIComponent(tmdbId)}/${season}/${episode}`
  const url = new URL(path, VIDCORE_EMBED_ORIGIN)
  url.searchParams.set('chromecast', 'false')
  url.searchParams.set('autoPlay', 'true')
  url.searchParams.set('theme', '2596be')
  return url.href
}

function sourceType(
  url: string,
  hint?: string
): Pick<ProviderLink, 'isM3U8' | 'isDASH'> {
  const type = hint?.toLowerCase() || ''
  return {
    isM3U8: type.includes('hls') || /\.m3u8(?:$|[?#])/i.test(url),
    ...(type.includes('dash') || /\.mpd(?:$|[?#])/i.test(url)
      ? { isDASH: true }
      : {}),
  }
}

async function fetchServer(
  server: VidCoreServer,
  config: VidCoreBundleConfig,
  pageUrl: string,
  artifact: BundleArtifact
): Promise<ProviderLink | null> {
  const url = new URL(
    `${config.sourcePrefix}/${config.sourceAction}/${encodeURIComponent(server.data)}`,
    new URL(pageUrl).origin
  )
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      Origin: new URL(pageUrl).origin,
      Referer: pageUrl,
      'User-Agent': USER_AGENT,
      'X-Requested-With': 'XMLHttpRequest',
      'X-Csrf-Token': config.csrfToken,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`${server.name} HTTP ${response.status}`)

  const payload = await decryptVidCorePayload<VidCoreSourcePayload>(
    artifact.url,
    artifact.source,
    await response.text()
  )
  const upstream = validHttpUrl(payload.url)
  if (!upstream) return null

  const playbackHeaders: Record<string, string> = {
    Accept: '*/*',
    'User-Agent': USER_AGENT,
    ...(payload.noReferrer
      ? {}
      : { Origin: new URL(pageUrl).origin, Referer: pageUrl }),
    ...(payload.headers ?? {}),
  }
  const subtitles = [
    ...(payload.tracks ?? []),
    ...(payload.subtitles ?? []),
  ].flatMap(track => {
    const file = validHttpUrl(track.file || track.url || track.src)
    if (!file) return []
    return [
      {
        file,
        label: track.label || track.language || track.lang || 'Unknown',
        kind: track.kind || 'captions',
      } satisfies Subtitle,
    ]
  })

  return {
    server: `Coreflix | ${server.name}${server.description ? ` | ${server.description}` : ''}`,
    url: upstream,
    ...sourceType(upstream, payload.type),
    quality: normalizeQuality(
      payload.quality ||
        (payload['4kAvailable'] ? '2160p' : '') ||
        `${server.name} ${upstream}`
    ),
    subtitles,
    headers: playbackHeaders,
    requiresProxy: true,
  }
}

async function getCoreflixStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season = 1,
  episode = 1
): Promise<ProviderLink[]> {
  if (!/^\d+$/.test(tmdbId)) return []
  if (
    mediaType === 'tv' &&
    (!Number.isInteger(season) ||
      season < 1 ||
      !Number.isInteger(episode) ||
      episode < 1)
  ) {
    return []
  }

  try {
    const requestedPage = buildPageUrl(tmdbId, mediaType, season, episode)
    const pageResponse = await fetch(requestedPage, {
      headers: PAGE_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!pageResponse.ok) {
      throw new Error(`VidCore page HTTP ${pageResponse.status}`)
    }
    const pageUrl = pageResponse.url
    if (!VIDCORE_ORIGINS.has(new URL(pageUrl).origin)) {
      throw new Error('VidCore page redirected to an unexpected origin')
    }

    const html = await pageResponse.text()
    const artifact = await loadBundle(html, pageUrl)
    const resolution = await resolveVidCoreServers(
      artifact.url,
      artifact.source,
      pageUrl,
      extractEnToken(html)
    )
    const settled = await Promise.allSettled(
      resolution.servers.map(server =>
        fetchServer(server, resolution.config, pageUrl, artifact)
      )
    )
    const links = settled.flatMap(result =>
      result.status === 'fulfilled' && result.value ? [result.value] : []
    )
    const failed = settled.length - links.length
    if (failed > 0) {
      console.warn(
        `[Coreflix] ${failed} of ${resolution.servers.length} upstream servers failed`
      )
    }
    return Array.from(
      new Map(links.map(link => [link.url, link] as const)).values()
    )
  } catch (error) {
    console.error(
      `[Coreflix] ${
        error instanceof Error ? error.stack || error.message : String(error)
      }`
    )
    return []
  }
}

export const coreflixProvider: Provider = {
  name: 'Coreflix',
  id: 'coreflix',
  alias: 'Damat',
  streamMovie: tmdbId =>
    withForcedForwardProxy(() => getCoreflixStreams(tmdbId, 'movie')),
  streamTV: (tmdbId, season, episode) =>
    withForcedForwardProxy(() =>
      getCoreflixStreams(tmdbId, 'tv', season, episode)
    ),
}
