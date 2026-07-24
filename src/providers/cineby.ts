import type { Provider, ProviderLink, Subtitle } from '../types/index.js'

// Repair notes and protocol reference: ./CINEBY_MAINTENANCE.md
const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
const CINEBY_API_BASE = 'https://api.speedracelight.com'
const CINEBY_ORIGIN = 'https://www.cineby.at'
const REQUEST_TIMEOUT_MS = 15_000
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'

// speedracelight is protected by Cloudflare and rejects generic server-side
// requests. These match the cross-site fetches made by Cineby's web player.
const API_HEADERS = {
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: CINEBY_ORIGIN,
  Referer: `${CINEBY_ORIGIN}/`,
  'Sec-CH-UA': '"Not.A/Brand";v="99", "Chromium";v="136"',
  'Sec-CH-UA-Mobile': '?0',
  'Sec-CH-UA-Platform': '"macOS"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'cross-site',
  'User-Agent': USER_AGENT,
}

// The resolved HLS host enforces Cineby's Origin and Referer.
const PLAYBACK_HEADERS = {
  Accept: '*/*',
  Origin: CINEBY_ORIGIN,
  Referer: `${CINEBY_ORIGIN}/`,
  'User-Agent': USER_AGENT,
}

interface CinebyServer {
  name: string
  endpoint: string
  audio: string
  qualityFilter?: string
}

const NEON_SERVER: CinebyServer = {
  name: 'Neon',
  endpoint: 'neon2/sources-with-title',
  audio: 'Original audio',
}

const SERVERS: CinebyServer[] = [
  {
    name: 'Yoru',
    endpoint: 'cdn/sources-with-title',
    audio: 'Original audio',
  },
  {
    name: 'Breach',
    endpoint: 'm4uhd/sources-with-title',
    audio: 'Original audio',
  },
  NEON_SERVER,
  {
    name: 'Vyse',
    endpoint: 'hdmovie/sources-with-title',
    audio: 'English',
    qualityFilter: 'English',
  },
  {
    name: 'Fade',
    endpoint: 'hdmovie/sources-with-title',
    audio: 'Hindi',
    qualityFilter: 'Hindi',
  },
  {
    name: 'Killjoy',
    endpoint: 'meine/sources-with-title',
    audio: 'German',
  },
  {
    name: 'Omen',
    endpoint: 'lamovie/sources-with-title',
    audio: 'Spanish',
  },
  {
    name: 'Raze',
    endpoint: 'superflix/sources-with-title',
    audio: 'Portuguese',
  },
]

interface TmdbDetails {
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
  number_of_seasons?: number
  external_ids?: {
    imdb_id?: string
  }
}

interface MediaDetails {
  title: string
  year: string
  imdbId: string
  totalSeasons: number
}

interface CinebySource {
  url?: string
  file?: string
  quality?: string
  label?: string
  title?: string
}

interface CinebySubtitle {
  url?: string
  file?: string
  lang?: string
  language?: string
  label?: string
}

interface CinebyPayload {
  sources?: CinebySource[]
  subtitles?: CinebySubtitle[]
  tracks?: CinebySubtitle[]
}

interface CipherState {
  values: number[]
  accumulator: number
}

interface SeedResponse {
  seed?: string
  ttlMs?: number
}

const GOLDEN_RATIO = 0x9e3779b9
const PAYLOAD_MAGIC = new Uint8Array([0x6d, 0x76, 0x6d, 0x31])

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

function fnvHash(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x1000193) >>> 0
  }
  return mix32(hash)
}

function initializeCipher(seed: string, mediaId: number): CipherState {
  if (!seed) throw new Error('Cineby returned an empty seed')

  const values = new Array<number>(61)
  let accumulator = mix32(
    (fnvHash(seed) ^ mix32((mediaId ^ GOLDEN_RATIO) >>> 0)) >>> 0
  )

  for (let round = 0; round < 8; round++) {
    const index = accumulator % values.length
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

function nextCipherWord(state: CipherState, counter: number): number {
  const index = state.accumulator % state.values.length
  const initializedMask = index in state.values ? -1 : 0
  const value = state.values[index] >>> 0
  const counterValue = Math.imul(GOLDEN_RATIO, counter + 1) >>> 0
  const combined =
    ((state.accumulator ^ (value ^ counterValue)) |
      (state.accumulator & (value ^ counterValue) & initializedMask)) >>>
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
  const state = initializeCipher(seed, mediaId)
  const output = new Uint8Array(length)
  let counter = 0

  for (let index = 0; index < length; ) {
    const word = nextCipherWord(state, counter++)
    output[index++] = word & 0xff
    if (index < length) output[index++] = (word >>> 8) & 0xff
    if (index < length) output[index++] = (word >>> 16) & 0xff
    if (index < length) output[index++] = (word >>> 24) & 0xff
  }

  return output
}

function decodePayload(
  encryptedText: string,
  seed: string,
  mediaId: number
): CinebyPayload {
  const encrypted = new Uint8Array(
    Buffer.from(
      encryptedText.trim().replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    )
  )
  const keystream = createKeystream(seed, mediaId, encrypted.length)

  for (let index = 0; index < encrypted.length; index++) {
    encrypted[index] ^= keystream[index]
  }

  if (
    encrypted.length < PAYLOAD_MAGIC.length ||
    PAYLOAD_MAGIC.some((byte, index) => encrypted[index] !== byte)
  ) {
    throw new Error('Cineby payload signature mismatch')
  }

  const json = new TextDecoder('utf-8', { fatal: true }).decode(
    encrypted.subarray(PAYLOAD_MAGIC.length)
  )
  const payload: unknown = JSON.parse(json)
  if (!payload || typeof payload !== 'object') {
    throw new Error('Cineby returned an invalid payload')
  }
  return payload as CinebyPayload
}

async function fetchMediaDetails(
  tmdbId: string,
  mediaType: 'movie' | 'tv'
): Promise<MediaDetails> {
  const apiKey = process.env.TMDB_API_KEY?.trim()
  if (!apiKey) throw new Error('TMDB_API_KEY is not configured')

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
  const date = data.first_air_date || data.release_date || ''
  if (!title) throw new Error('TMDB response did not include a title')

  return {
    title,
    year: date.slice(0, 4),
    imdbId: data.external_ids?.imdb_id || '',
    totalSeasons:
      mediaType === 'tv' && Number.isInteger(data.number_of_seasons)
        ? Math.max(0, data.number_of_seasons || 0)
        : 0,
  }
}

async function fetchSeed(tmdbId: string): Promise<string> {
  const url = new URL(`${CINEBY_API_BASE}/seed`)
  url.searchParams.set('mediaId', tmdbId)

  const response = await fetch(url, {
    headers: API_HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Cineby seed HTTP ${response.status}`)

  const data = (await response.json()) as SeedResponse
  if (!data.seed) throw new Error('Cineby response did not include a seed')
  return data.seed
}

function normalizeQuality(value?: string): string {
  const quality = String(value || 'Auto').trim()
  if (/2160|4k/i.test(quality)) return '2160p'
  if (/1080/i.test(quality)) return '1080p'
  if (/720/i.test(quality)) return '720p'
  if (/480/i.test(quality)) return '480p'
  if (/360/i.test(quality)) return '360p'
  if (/^(?:english|german|hindi|spanish|portuguese)$/i.test(quality)) {
    return 'Auto'
  }
  return quality || 'Auto'
}

function formatSubtitles(payload: CinebyPayload): Subtitle[] {
  const entries = [...(payload.subtitles || []), ...(payload.tracks || [])]
  return Array.from(
    new Map(
      entries.flatMap(subtitle => {
        const file = subtitle.url || subtitle.file
        if (!file || !/^https?:\/\//i.test(file)) return []

        const label =
          subtitle.language || subtitle.lang || subtitle.label || 'Unknown'
        const normalized: Subtitle = {
          file,
          label,
          kind: 'captions',
        }
        return [[`${file}\n${label}`, normalized] as const]
      })
    ).values()
  )
}

function formatLinks(
  payload: CinebyPayload,
  server: CinebyServer
): ProviderLink[] {
  const subtitles = formatSubtitles(payload)
  const filter = server.qualityFilter?.toLowerCase()

  return (payload.sources || []).flatMap((source, index) => {
    const sourceLabel = String(
      source.quality || source.label || source.title || ''
    ).trim()
    if (filter && sourceLabel.toLowerCase() !== filter) return []

    const value = source.url || source.file
    if (!value) return []

    try {
      const url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol)) return []

      return [
        {
          server: `Cineby | ${server.name} | ${server.audio} | ${index + 1}`,
          url: url.href,
          isM3U8: /\.m3u8(?:$|[?#])/i.test(url.href),
          quality: normalizeQuality(sourceLabel),
          subtitles,
          headers: PLAYBACK_HEADERS,
          requiresProxy: true,
        } satisfies ProviderLink,
      ]
    } catch {
      return []
    }
  })
}

async function fetchServer(
  server: CinebyServer,
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  details: MediaDetails,
  seed: string,
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  const url = new URL(`${CINEBY_API_BASE}/${server.endpoint}`)

  // Cineby's client pre-encodes the title before its request library encodes
  // the complete query string, so URLSearchParams intentionally encodes it a
  // second time here.
  url.searchParams.set('title', encodeURIComponent(details.title))
  url.searchParams.set('mediaType', mediaType)
  url.searchParams.set('year', details.year)
  url.searchParams.set('totalSeasons', String(details.totalSeasons))
  url.searchParams.set('episodeId', String(episode || 1))
  url.searchParams.set('seasonId', String(season || 1))
  url.searchParams.set('tmdbId', tmdbId)
  url.searchParams.set('imdbId', details.imdbId)
  url.searchParams.set('enc', '2')
  url.searchParams.set('seed', seed)

  const response = await fetch(url, {
    headers: API_HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const encryptedText = (await response.text()).trim()
  if (!encryptedText) return []
  return formatLinks(decodePayload(encryptedText, seed, Number(tmdbId)), server)
}

function qualityScore(quality: string): number {
  if (/auto|adaptive/i.test(quality)) return 4_000
  return Number(quality.match(/\d{3,4}/)?.[0] || 0)
}

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number,
  servers: CinebyServer[] = SERVERS
): Promise<ProviderLink[]> {
  try {
    if (!/^\d+$/.test(tmdbId)) throw new Error('TMDB ID must be numeric')
    if (
      mediaType === 'tv' &&
      (!Number.isInteger(season) ||
        !Number.isInteger(episode) ||
        (season || 0) < 1 ||
        (episode || 0) < 1)
    ) {
      throw new Error('Season and episode must be positive integers')
    }

    const details = await fetchMediaDetails(tmdbId, mediaType)
    // Seeds expire after roughly 30 seconds, so obtain one only after metadata
    // lookup and query all player servers concurrently.
    const seed = await fetchSeed(tmdbId)
    const settled = await Promise.allSettled(
      servers.map(server =>
        fetchServer(server, tmdbId, mediaType, details, seed, season, episode)
      )
    )

    settled.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn(
          `[Cineby] ${servers[index].name} failed: ${
            result.reason instanceof Error
              ? result.reason.message
              : 'Unknown error'
          }`
        )
      }
    })

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
      `[Cineby] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

// WatchFlux currently server-renders this same single Neon source. Keeping the
// resolver here avoids duplicating Cineby's encrypted response protocol.
export function getCinebyNeonStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  return getStreams(tmdbId, mediaType, season, episode, [NEON_SERVER])
}

export const cinebyProvider: Provider = {
  name: 'Cineby',
  id: 'cineby',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
