import type { Provider, ProviderLink, Subtitle } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'
import {
  formatRequestError,
  redactUrl,
  responseBodySnippet,
  responseDiagnostics,
} from '../utils/request-diagnostics.js'

const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
const WINGS_API_BASE = 'https://api.speedracelight.com'
const REQUEST_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const REQUEST_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: '*/*',
  Origin: 'https://www.vidking.net',
  Referer: 'https://www.vidking.net/',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
}

const SERVERS: Record<string, string> = {
  Hydrogen: 'cdn/sources-with-title',
  Titanium: 'tejo/sources-with-title',
  Oxygen: 'neon2/sources-with-title',
  Lithium: 'downloader2/sources-with-title',
  Krypton: 'ym/sources-with-title',
  Carbon: 'mb-flix/sources-with-title',
  Aluminium: 'lamovie/sources-with-title',
  Nitrogen: 'm4uhd/sources-with-title',
  Neon: 'superflix/sources-with-title',
  Helium: '1movies/sources-with-title',
}

const SERVER_LABELS: Record<string, string> = {
  Hydrogen: 'CDN',
  Titanium: 'Tejo',
  Oxygen: 'Neon2',
  Lithium: 'Downloader2',
  Krypton: 'YM',
  Carbon: 'MB-Flix',
  Aluminium: 'LAMovie',
  Nitrogen: 'M4UHD',
  Neon: 'SuperFlix',
  Helium: '1Movies',
}

interface TmdbDetails {
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
  runtime?: number
  episode_run_time?: number[]
  external_ids?: { imdb_id?: string }
}

interface MediaDetails {
  title: string
  year: string
  imdbId: string
  duration: string
}

interface WingsSource {
  url?: string
  quality?: string
  title?: string
}

interface WingsSubtitle {
  url?: string
  language?: string
  label?: string
}

interface WingsPayload {
  sources?: WingsSource[]
  subtitles?: WingsSubtitle[]
}

interface WingsState {
  values: number[]
  accumulator: number
}

const GOLDEN_RATIO = 0x9e3779b9
const MAGIC = new Uint8Array([0x6d, 0x76, 0x6d, 0x31])

function mix32(value: number): number {
  value >>>= 0
  value ^= value >>> 16
  value = Math.imul(value, 0x85ebca6b) >>> 0
  value ^= value >>> 13
  value = Math.imul(value, 0xc2b2ae35) >>> 0
  value ^= value >>> 16
  return value >>> 0
}

function rotateLeft(value: number, shift: number): number {
  value >>>= 0
  shift &= 31
  return shift === 0
    ? value
    : ((value << shift) | (value >>> (32 - shift))) >>> 0
}

function fnvHash(seed: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < seed.length; index++) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 0x1000193) >>> 0
  }
  return mix32(hash)
}

function initializeState(seed: string, mediaId: number): WingsState {
  if (!seed) throw new Error('VidEasy returned an empty seed')
  const values = new Array<number>(61)
  let accumulator = mix32(
    (fnvHash(seed) ^ mix32((mediaId ^ GOLDEN_RATIO) >>> 0)) >>> 0
  )

  for (let round = 0; round < 8; round++) {
    const index = accumulator % 61
    accumulator = rotateLeft(
      (accumulator + GOLDEN_RATIO) >>> 0,
      7 + (round & 7)
    )
    values[index] = (accumulator ^ mix32(accumulator)) >>> 0
    accumulator = mix32((accumulator + index) >>> 0)
  }

  return {
    values,
    accumulator: mix32((accumulator ^ 0xa5a5a5a5) >>> 0),
  }
}

function nextWord(state: WingsState, counter: number): number {
  const index = state.accumulator % 61
  const mask = index in state.values ? -1 : 0
  const value = state.values[index] >>> 0
  const counterValue = Math.imul(GOLDEN_RATIO, counter + 1) >>> 0
  const combined =
    ((state.accumulator ^ (value ^ counterValue)) |
      (state.accumulator & (value ^ counterValue) & mask)) >>>
    0

  const word =
    (rotateLeft((combined + state.accumulator) >>> 0, index & 31) ^
      rotateLeft(state.accumulator, Math.imul(index, 7) & 31)) >>>
    0
  state.accumulator = mix32((word + GOLDEN_RATIO) >>> 0)
  state.values[index] = state.accumulator
  return state.accumulator
}

function createKeystream(
  seed: string,
  mediaId: number,
  length: number
): Uint8Array {
  const state = initializeState(seed, mediaId)
  const output = new Uint8Array(length)
  let counter = 0

  for (let index = 0; index < length; ) {
    const word = nextWord(state, counter++)
    output[index++] = word & 0xff
    if (index < length) output[index++] = (word >>> 8) & 0xff
    if (index < length) output[index++] = (word >>> 16) & 0xff
    if (index < length) output[index++] = (word >>> 24) & 0xff
  }
  return output
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  return new Uint8Array(Buffer.from(normalized, 'base64'))
}

function decryptWingsPayload(
  encryptedText: string,
  seed: string,
  mediaId: number
): WingsPayload {
  const encrypted = decodeBase64Url(encryptedText.trim())
  const key = createKeystream(seed, mediaId, encrypted.length)
  for (let index = 0; index < encrypted.length; index++) {
    encrypted[index] ^= key[index]
  }

  if (MAGIC.some((byte, index) => encrypted[index] !== byte)) {
    throw new Error('VidEasy payload signature mismatch')
  }

  const json = new TextDecoder().decode(encrypted.slice(MAGIC.length))
  return JSON.parse(json) as WingsPayload
}

async function fetchMediaDetails(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<MediaDetails | null> {
  const apiKey = process.env.TMDB_API_KEY?.trim()
  if (!apiKey) {
    console.error('[VidEasy] TMDB_API_KEY is not configured')
    return null
  }

  const url = new URL(
    `${TMDB_BASE_URL}/${mediaType}/${encodeURIComponent(tmdbId)}`
  )
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('append_to_response', 'external_ids')
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`TMDB HTTP ${response.status}`)

  const data = (await response.json()) as TmdbDetails
  const title = mediaType === 'tv' ? data.name : data.title
  if (!title) return null

  let duration =
    mediaType === 'movie' && data.runtime
      ? `${data.runtime} min`
      : data.episode_run_time?.[0]
        ? `${data.episode_run_time[0]} min`
        : mediaType === 'tv'
          ? '45 min'
          : '120 min'

  if (mediaType === 'tv' && season !== undefined && episode !== undefined) {
    try {
      const episodeUrl = new URL(
        `${TMDB_BASE_URL}/tv/${encodeURIComponent(tmdbId)}/season/${season}/episode/${episode}`
      )
      episodeUrl.searchParams.set('api_key', apiKey)
      const episodeResponse = await fetch(episodeUrl, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (episodeResponse.ok) {
        const episodeData = (await episodeResponse.json()) as {
          runtime?: number
        }
        if (episodeData.runtime) duration = `${episodeData.runtime} min`
      }
    } catch {
      // Duration is display metadata and does not affect extraction.
    }
  }

  return {
    title,
    year: (data.first_air_date || data.release_date || '').slice(0, 4),
    imdbId: data.external_ids?.imdb_id || '',
    duration,
  }
}

async function getSeed(tmdbId: string): Promise<string> {
  const seedUrl = `${WINGS_API_BASE}/seed?mediaId=${encodeURIComponent(tmdbId)}`
  console.log(`[VidEasy] Requesting seed: ${seedUrl}`)
  const startedAt = Date.now()
  const response = await fetch(seedUrl, {
    headers: REQUEST_HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  console.log(
    `[VidEasy:seed] Completed in ${Date.now() - startedAt}ms: ${responseDiagnostics(response)}`
  )
  if (!response.ok) {
    console.warn(
      `[VidEasy:seed] Non-2xx body: ${await responseBodySnippet(response)}`
    )
    throw new Error(
      `Seed HTTP ${response.status} (${response.statusText}) from URL: ${seedUrl}`
    )
  }
  const data = (await response.json()) as { seed?: string }
  if (!data.seed) {
    throw new Error(`VidEasy response from ${seedUrl} did not include a seed`)
  }
  console.log(`[VidEasy:seed] Seed received (${data.seed.length} characters)`)
  return data.seed
}

function subtitleLanguage(value: string): string {
  const languages: Record<string, string> = {
    english: 'en',
    spanish: 'es',
    french: 'fr',
    german: 'de',
    italian: 'it',
    portuguese: 'pt',
    arabic: 'ar',
    japanese: 'ja',
    korean: 'ko',
    hindi: 'hi',
    tamil: 'ta',
    telugu: 'te',
  }
  return languages[value.toLowerCase().trim()] || value || 'Unknown'
}

function normalizeQuality(value: string | undefined): string {
  const quality = String(value || 'Auto')
    .replace(/\s*server\s*2\s*$/i, '')
    .trim()
  if (/2160|4k/i.test(quality)) return '2160p'
  if (/1080/i.test(quality)) return '1080p'
  if (/720/i.test(quality)) return '720p'
  if (/480/i.test(quality)) return '480p'
  if (/360/i.test(quality)) return '360p'
  if (
    /^(?:auto|adaptive|vimeos|voesx|playhq|streamwish|filemoon|filelions|streamtape|doodstream|upstream|mixdrop)$/i.test(
      quality
    )
  ) {
    return 'Auto'
  }
  return quality || 'Auto'
}

function formatLinks(
  payload: WingsPayload,
  serverName: string
): ProviderLink[] {
  const subtitles: Subtitle[] = (payload.subtitles || []).flatMap(subtitle => {
    if (!subtitle.url) return []
    const label = subtitle.language || subtitle.label || 'Unknown'
    return [
      {
        file: subtitle.url,
        label: subtitleLanguage(label),
        kind: 'captions',
      },
    ]
  })

  return (payload.sources || []).flatMap(source => {
    if (!source.url) return []
    try {
      const url = new URL(source.url).href
      return [
        {
          server: `VidEasy | ${serverName} | ${SERVER_LABELS[serverName] || serverName}`,
          url,
          isM3U8: /\.m3u8(?:$|[?#])/i.test(url),
          quality: normalizeQuality(source.quality),
          subtitles,
          headers: {
            Referer: REQUEST_HEADERS.Referer,
            Origin: REQUEST_HEADERS.Origin,
            'User-Agent': USER_AGENT,
          },
        } satisfies ProviderLink,
      ]
    } catch {
      return []
    }
  })
}

async function fetchServer(
  serverName: string,
  path: string,
  mediaType: 'movie' | 'tv',
  tmdbId: string,
  details: MediaDetails,
  seed: string,
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  const url = new URL(`${WINGS_API_BASE}/${path}`)
  url.searchParams.set('title', details.title)
  url.searchParams.set('mediaType', mediaType)
  url.searchParams.set('year', details.year)
  url.searchParams.set('episodeId', String(episode || 1))
  url.searchParams.set('seasonId', String(season || 1))
  url.searchParams.set('tmdbId', tmdbId)
  url.searchParams.set('imdbId', details.imdbId)
  url.searchParams.set('enc', '2')
  url.searchParams.set('seed', seed)

  try {
    const startedAt = Date.now()
    console.log(`[VidEasy:${serverName}] Requesting ${redactUrl(url.href)}`)
    const response = await fetch(url, {
      headers: REQUEST_HEADERS,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    console.log(
      `[VidEasy:${serverName}] Completed in ${Date.now() - startedAt}ms: ${responseDiagnostics(response)}`
    )
    if (!response.ok) {
      console.warn(
        `[VidEasy:${serverName}] Non-2xx body: ${await responseBodySnippet(response)}`
      )
      throw new Error(`HTTP ${response.status} (${response.statusText})`)
    }
    const encryptedText = await response.text()
    if (!encryptedText.trim()) {
      console.warn(
        `[VidEasy] Server [${serverName}] returned empty payload (${url.href})`
      )
      return []
    }
    const links = formatLinks(
      decryptWingsPayload(encryptedText, seed, Number(tmdbId)),
      serverName
    )
    console.log(
      `[VidEasy] Server [${serverName}] extracted ${links.length} stream(s)`
    )
    return links
  } catch (error) {
    console.warn(
      `[VidEasy:${serverName}] Failed for ${redactUrl(url.href)}: ${formatRequestError(error)}`
    )
    return []
  }
}

function qualityScore(quality: string): number {
  if (/auto|adaptive/i.test(quality)) return 4_000
  return Number(quality.match(/\d{3,4}/)?.[0] || 0)
}

async function getVidEasyStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  try {
    const [details, seed] = await Promise.all([
      fetchMediaDetails(tmdbId, mediaType, season, episode),
      getSeed(tmdbId),
    ])
    if (!details) {
      console.warn(
        `[VidEasy] Failed to fetch media details from TMDB for ID: ${tmdbId}`
      )
      return []
    }

    const settled = await Promise.allSettled(
      Object.entries(SERVERS).map(([name, path]) =>
        fetchServer(
          name,
          path,
          mediaType,
          tmdbId,
          details,
          seed,
          season,
          episode
        )
      )
    )
    const links = settled.flatMap(result =>
      result.status === 'fulfilled' ? result.value : []
    )
    const unique = Array.from(
      new Map(links.map(link => [link.url, link])).values()
    )
    return unique.sort(
      (left, right) => qualityScore(right.quality) - qualityScore(left.quality)
    )
  } catch (error) {
    console.error(
      `[VidEasy] Request failed for TMDB ${tmdbId}: ${formatRequestError(error)}`
    )
    return []
  }
}

export const vidEasyProvider: Provider = {
  name: 'VidEasy',
  id: 'videasy',
  streamMovie: tmdbId => getVidEasyStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getVidEasyStreams(tmdbId, 'tv', season, episode),
}
