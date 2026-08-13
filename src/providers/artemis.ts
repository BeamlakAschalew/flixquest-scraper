import type { Provider, ProviderLink } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'

// Protocol and repair notes: ./ARTEMIS_MAINTENANCE.md
//
// Z-Stream renamed its former Artemis source to Celestial and later moved it
// to the Vault aggregator. Keep the public provider id stable for API
// compatibility while following the live source.
const VAULT_API_BASE =
  process.env.ARTEMIS_API_BASE_URL?.trim() || 'https://stream.fontaine.lol'
const ZSTREAM_ORIGIN = 'https://zstream.mov'
const REQUEST_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'

const LOOKUP_HEADERS: Record<string, string> = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: `${ZSTREAM_ORIGIN}/`,
  'User-Agent': USER_AGENT,
}

const PLAYBACK_HEADERS: Record<string, string> = {
  Accept: '*/*',
  Referer: `${ZSTREAM_ORIGIN}/`,
  'User-Agent': USER_AGENT,
}

interface VaultSource {
  url?: string
  type?: string
}

interface VaultResponse {
  sources?: Record<string, VaultSource>
}

function isValidTmdbId(tmdbId: string): boolean {
  return /^\d+$/.test(tmdbId)
}

function isValidEpisodeNumber(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function mediaUrl(value: string | undefined): URL | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/**
 * The Vault aggregator keys media by IMDb id, so resolve one from TMDB.
 * A failed lookup only means this media cannot be served by the Vault.
 */
async function lookupImdbId(
  tmdbId: string,
  mediaType: 'movie' | 'tv'
): Promise<string | null> {
  const apiKey = process.env.TMDB_API_KEY?.trim()
  if (!apiKey) return null

  try {
    const path =
      mediaType === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}/external_ids`
    const response = await fetch(
      `https://api.themoviedb.org/3${path}?api_key=${encodeURIComponent(apiKey)}`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    )
    if (!response.ok) return null

    const payload = (await response.json()) as { imdb_id?: string }
    const imdbId = payload.imdb_id?.trim()
    return imdbId && /^tt\d{5,}$/i.test(imdbId) ? imdbId : null
  } catch {
    return null
  }
}

async function lookupStreams(
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

  const imdbId = await lookupImdbId(tmdbId, mediaType)
  if (!imdbId) return []

  const query = new URLSearchParams({
    tmdbId,
    imdbId,
    type: mediaType === 'movie' ? 'movie' : 'tv',
  })
  if (mediaType === 'tv') {
    query.set('seasonId', String(season))
    query.set('episodeId', String(episode))
  }

  const response = await fetch(`${VAULT_API_BASE}/vault?${query}`, {
    method: 'GET',
    headers: LOOKUP_HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  // 400 means the Vault cannot key this media (for example a missing IMDb
  // id on their side); 404 means it has not mirrored the title.
  if (response.status === 400 || response.status === 404) {
    await response.body?.cancel()
    return []
  }

  if (!response.ok) {
    const details = (await response.text()).slice(0, 300)
    throw new Error(
      `Vault lookup failed with HTTP ${response.status}${
        details ? `: ${details}` : ''
      }`
    )
  }

  const payload = (await response.json()) as VaultResponse
  const sources = payload.sources ?? {}

  return Object.entries(sources).flatMap(([name, entry]): ProviderLink[] => {
    const streamUrl = mediaUrl(entry?.url)
    if (!streamUrl) return []

    const streamType = entry.type?.toLowerCase() || ''
    const isM3U8 =
      streamType === 'hls' || /\.m3u8(?:$|[?#])/i.test(streamUrl.href)
    const isDASH =
      streamType === 'dash' || /\.mpd(?:$|[?#])/i.test(streamUrl.href)

    return [
      {
        server: `ZStream | Vault · ${name}`,
        url: streamUrl.href,
        isM3U8,
        ...(isDASH ? { isDASH: true } : {}),
        quality: 'auto',
        subtitles: [],
        headers: PLAYBACK_HEADERS,
        requiresProxy: true,
      },
    ]
  })
}

export const artemisProvider: Provider = {
  name: 'ZStream | Artemis (Celestial)',
  id: 'artemis',
  streamMovie: tmdbId => lookupStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    lookupStreams(tmdbId, 'tv', season, episode),
}
