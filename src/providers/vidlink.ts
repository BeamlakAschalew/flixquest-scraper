import type { Provider, ProviderLink, Subtitle } from '../types/index.js'

const BASE_URL = 'https://vidlink.pro'
const ENCRYPT_URL = 'https://enc-dec.app/api/enc-vidlink'
const REQUEST_TIMEOUT_MS = 12_000
const MAX_REQUEST_ATTEMPTS = 2
const HEADERS = {
  Accept: 'application/json,*/*',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  Referer: `${BASE_URL}/`,
  Origin: BASE_URL,
}

interface VidlinkQuality {
  url?: string
  headers?: Record<string, string>
}

interface VidlinkSubtitle {
  file?: string
  url?: string
  label?: string
  lang?: string
  language?: string
}

interface VidlinkResponse {
  stream?: {
    playlist?: string
    qualities?: Record<string, string | VidlinkQuality>
    captions?: VidlinkSubtitle[]
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
    const payload = await requestJson<VidlinkResponse>(
      `${BASE_URL}${path}?multiLang=0`,
      HEADERS
    )
    const subtitles = subtitlesFrom(payload)
    const candidates = new Map<
      string,
      { quality: string; headers: Record<string, string> }
    >()
    if (payload.stream?.playlist)
      candidates.set(payload.stream.playlist, {
        quality: 'auto',
        headers: HEADERS,
      })
    for (const [quality, value] of Object.entries(
      payload.stream?.qualities || {}
    )) {
      const url = typeof value === 'string' ? value : value?.url
      if (!url) continue
      candidates.set(url, {
        quality,
        headers: typeof value === 'string' ? HEADERS : value.headers || HEADERS,
      })
    }

    const streams = Array.from(candidates, ([url, candidate], index) => ({
      server: `vidlink-${index + 1}`,
      url,
      isM3U8: /\.m3u8(?:$|[?#])/i.test(url),
      quality: candidate.quality.toLowerCase().replace(/^(\d+)$/, '$1p'),
      subtitles,
      headers: candidate.headers,
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
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
