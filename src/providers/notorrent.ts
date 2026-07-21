import axios from 'axios'
import type { Provider, ProviderLink } from '../types/index.js'

const TMDB_API_URL = 'https://api.themoviedb.org/3'
const NOTORRENT_API = 'https://addon-osvh.onrender.com'

interface TmdbExternalIdsResponse {
  imdb_id?: string | null
  external_ids?: {
    imdb_id?: string | null
  }
}

interface NoTorrentStream {
  url?: string
  externalUrl?: string
  title?: string
  behaviorHints?: {
    headers?: Record<string, unknown>
    proxyHeaders?: {
      request?: Record<string, unknown>
    }
  }
}

interface NoTorrentResponse {
  streams?: NoTorrentStream[]
}

function getTmdbApiKey(): string | undefined {
  const apiKey = process.env.TMDB_API_KEY?.trim()
  return apiKey || undefined
}

function cleanText(value: string): string {
  return value.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]/gu, '').trim()
}

function extractQuality(title: string): string {
  const match = title.match(/(\d{3,4}p)/i)
  if (match) return match[1].toLowerCase()
  return title.toUpperCase().includes('FREE') ? 'auto' : 'unknown'
}

function normalizeHeaders(
  ...headerSets: Array<Record<string, unknown> | undefined>
): Record<string, string> | undefined {
  const entries = headerSets.flatMap(headers =>
    Object.entries(headers || {}).flatMap(([key, value]) =>
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
        ? [[key, String(value)] as const]
        : []
    )
  )
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

async function fetchImdbId(
  tmdbId: string,
  mediaType: 'movie' | 'tv'
): Promise<string | null> {
  const apiKey = getTmdbApiKey()
  if (!apiKey) {
    console.error('[NoTorrent] TMDB_API_KEY is not configured')
    return null
  }

  try {
    const response = await axios.get<TmdbExternalIdsResponse>(
      `${TMDB_API_URL}/${mediaType}/${tmdbId}`,
      {
        params: {
          api_key: apiKey,
          append_to_response: 'external_ids',
        },
        timeout: 8_000,
      }
    )

    return response.data.external_ids?.imdb_id || response.data.imdb_id || null
  } catch (error) {
    console.error(
      `[NoTorrent] TMDB lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return null
  }
}

function buildAddonUrl(
  imdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): string {
  return mediaType === 'tv'
    ? `${NOTORRENT_API}/stream/series/${imdbId}:${season}:${episode}.json`
    : `${NOTORRENT_API}/stream/movie/${imdbId}.json`
}

function isPlaceholderStream(url: string, title: string): boolean {
  const combined = `${url} ${title}`
  return (
    /(?:^|\/)(?:premium|placeholder|sample|demo)(?:[-_.][^/?#]*)?\.mp4(?:[?#]|$)/i.test(
      url
    ) ||
    /\b(?:placeholder|sample video|demo video|test video|premium player|premium video|configure addon|mpv player)\b/i.test(
      combined
    ) ||
    /\b(?:big buck bunny|elephants dream|sintel)\b/i.test(combined)
  )
}

function mapStream(item: NoTorrentStream): ProviderLink | null {
  const title = cleanText(item.title || '')
  if (
    item.externalUrl ||
    !item.url ||
    item.url.includes('github.com') ||
    item.url.includes('googleusercontent') ||
    isPlaceholderStream(item.url, title)
  ) {
    return null
  }

  try {
    const url = new URL(item.url)
    if (!['http:', 'https:'].includes(url.protocol)) return null

    const quality = extractQuality(title)
    const languageMatch = title.match(/\(([^)]+)\)/)
    const language = languageMatch
      ? languageMatch[1].charAt(0).toUpperCase() +
        languageMatch[1].slice(1).toLowerCase()
      : undefined
    const headers = normalizeHeaders(
      item.behaviorHints?.headers,
      item.behaviorHints?.proxyHeaders?.request
    )

    return {
      server: language ? `NoTorrent | ${language}` : 'NoTorrent',
      url: url.href,
      isM3U8: /\.m3u8(?:$|\?)/i.test(url.href),
      quality,
      subtitles: [],
      ...(headers && { headers }),
    }
  } catch {
    return null
  }
}

async function getNoTorrentStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  console.log(`[NoTorrent] Searching for ${mediaType} ${tmdbId}`)

  const imdbId = await fetchImdbId(tmdbId, mediaType)
  if (!imdbId) {
    console.warn('[NoTorrent] Failed to map an IMDb ID from TMDB')
    return []
  }

  try {
    const response = await axios.get<NoTorrentResponse>(
      buildAddonUrl(imdbId, mediaType, season, episode),
      { timeout: 20_000 }
    )
    const streams = Array.isArray(response.data.streams)
      ? response.data.streams
          .map(mapStream)
          .filter((stream): stream is ProviderLink => stream !== null)
      : []

    console.log(`[NoTorrent] Total results found: ${streams.length}`)
    return streams
  } catch (error) {
    console.error(
      `[NoTorrent] Fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return []
  }
}

export const noTorrentProvider: Provider = {
  name: 'NoTorrent',
  id: 'notorrent',
  streamMovie: tmdbId => getNoTorrentStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getNoTorrentStreams(tmdbId, 'tv', season, episode),
}
