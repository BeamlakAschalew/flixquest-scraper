import type { Provider, ProviderLink, Subtitle } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'

const BASE_URL = 'https://vidlink.pro'
const ENCRYPT_URL = 'https://enc-dec.app/api/enc-vidlink'
const REQUEST_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS
const MAX_REQUEST_ATTEMPTS = 2
const HEADERS = {
  Accept: 'application/json,*/*',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  Referer: `${BASE_URL}/`,
  Origin: BASE_URL,
}
const PLAYBACK_ENVIRONMENT_HEADER = 'X-Playback-Environment'
const DASH_PLAYBACK_ENVIRONMENT = 'dash-hevc'
const STANDARD_PLAYBACK_ENVIRONMENT = 'standard'

interface VidlinkQuality {
  url?: string
  headers?: Record<string, string>
  requiresProxy?: boolean
}

interface VidlinkSubtitle {
  file?: string
  url?: string
  label?: string
  lang?: string
  language?: string
}

interface VidlinkResponse {
  sourceId?: string
  stream?: {
    type?: string
    deliveryType?: string
    playlist?: string
    playlistHeaders?: Record<string, string>
    qualities?: Record<string, string | VidlinkQuality>
    captions?: VidlinkSubtitle[]
    requiresProxy?: boolean
    playbackMetadata?: {
      resolutions?: string[]
    }
  }
  subtitles?: VidlinkSubtitle[]
}

async function requestJson<T>(
  url: string,
  headers?: Record<string, string>
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok)
        throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`)
      return (await response.json()) as T
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

function subtitlesFrom(payload: VidlinkResponse): Subtitle[] {
  return (payload.stream?.captions || payload.subtitles || []).flatMap(item => {
    const file = item.file || item.url
    if (!file || !/^https?:\/\//i.test(file)) return []
    return [
      {
        file,
        label: item.label || item.lang || item.language || 'Unknown',
        kind: 'captions',
      },
    ]
  })
}

function playbackHeaders(environment: string): Record<string, string> {
  return {
    ...HEADERS,
    [PLAYBACK_ENVIRONMENT_HEADER]: environment,
  }
}

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  try {
    const encrypted = await requestJson<{ result?: string }>(
      `${ENCRYPT_URL}?text=${encodeURIComponent(tmdbId)}`
    )
    if (!encrypted.result)
      throw new Error('Encryption service returned no result')

    const path =
      mediaType === 'movie'
        ? `/api/b/movie/${encodeURIComponent(encrypted.result)}`
        : `/api/b/tv/${encodeURIComponent(encrypted.result)}/${season}/${episode}`
    const apiUrl = `${BASE_URL}${path}?multiLang=0`
    const [payload, standardPayload] = await Promise.all([
      requestJson<VidlinkResponse>(
        apiUrl,
        playbackHeaders(DASH_PLAYBACK_ENVIRONMENT)
      ),
      requestJson<VidlinkResponse>(
        apiUrl,
        playbackHeaders(STANDARD_PLAYBACK_ENVIRONMENT)
      ).catch(() => undefined),
    ])
    const subtitles = subtitlesFrom(payload)
    const candidates = new Map<
      string,
      {
        url: string
        quality: string
        headers: Record<string, string>
        isDASH: boolean
        dashVideoHeight?: number
        requiresProxy: boolean
      }
    >()
    if (payload.stream?.playlist) {
      const isDASH =
        payload.stream.deliveryType === 'dash' ||
        payload.stream.type === 'dash' ||
        /\.mpd(?:$|[?#])/i.test(payload.stream.playlist)
      const resolutions = Array.from(
        new Set(
          (payload.stream.playbackMetadata?.resolutions || [])
            .map(value => Number.parseInt(value, 10))
            .filter(value => Number.isFinite(value) && value > 0)
        )
      ).sort((left, right) => right - left)
      const variants = isDASH && resolutions.length ? resolutions : [undefined]
      for (const height of variants) {
        candidates.set(`${payload.stream.playlist}|dash:${height || 'auto'}`, {
          url: payload.stream.playlist,
          quality: height ? `${height}p` : 'auto',
          headers: {
            ...HEADERS,
            ...(payload.stream.playlistHeaders || {}),
          },
          isDASH,
          dashVideoHeight: height,
          requiresProxy: payload.stream.requiresProxy === true,
        })
      }
    }
    for (const [quality, value] of Object.entries(
      standardPayload?.stream?.qualities || payload.stream?.qualities || {}
    )) {
      const url = typeof value === 'string' ? value : value?.url
      if (!url) continue
      candidates.set(url, {
        url,
        quality,
        headers: typeof value === 'string' ? HEADERS : value.headers || HEADERS,
        isDASH: false,
        requiresProxy:
          typeof value === 'string' ? false : value.requiresProxy === true,
      })
    }

    const streams = Array.from(candidates.values(), (candidate, index) => ({
      server: `vidlink-${payload.sourceId || 'default'}-${index + 1}`,
      url: candidate.url,
      isM3U8: /\.m3u8(?:$|[?#])/i.test(candidate.url),
      isDASH: candidate.isDASH,
      dashVideoHeight: candidate.dashVideoHeight,
      quality: candidate.quality.toLowerCase().replace(/^(\d+)$/, '$1p'),
      subtitles,
      headers: candidate.headers,
      requiresProxy: candidate.requiresProxy,
    })).filter(link => /^https?:\/\//i.test(link.url))
    console.log(
      `[Vidlink] Extracted ${streams.length} candidate stream(s); response fields: ${Object.keys(payload).join(', ') || 'none'}`
    )
    return streams
  } catch (error) {
    console.error(
      `[Vidlink] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const vidlinkProvider: Provider = {
  name: 'Vidlink',
  id: 'vidlink',
  alias: 'Gumma',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
