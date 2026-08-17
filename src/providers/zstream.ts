import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto'
import type { Provider, ProviderLink } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'
import { withForcedForwardProxy } from '../utils/forward-proxy.js'

// Protocol and repair notes: ./ZSTREAM_MAINTENANCE.md
//
// zstream.mov's remaining public sources are the Fontaine aggregators on
// stream.fontaine.lol: Vault, Shibuya and Neko. Shibuya and Neko require a
// per-request proof derived from the fixed PStream key schedule; Vault is a
// plain IMDb-keyed lookup.
const FONTAINE_BASE =
  process.env.ZSTREAM_API_BASE_URL?.trim() || 'https://stream.fontaine.lol'
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

// Fixed key schedule reconstructed from ZStream's production bundle.
// The seed hostname resolves to the client's built-in fallback value.
const SEED_TEXT = 'pstream-prelude-token-mix-v1'
const SIGNATURE_HOSTNAME = 'localhost'
const KY = new Uint8Array([
  200, 13, 74, 239, 55, 218, 133, 59, 56, 223, 74, 147, 81, 162, 182, 5, 112,
  80, 134, 243, 33, 253, 17, 37, 157, 51, 79, 156, 203, 69, 5, 192, 196, 10, 23,
  238, 49, 141, 219, 61, 108, 142, 18, 192, 2, 168, 229, 87, 32, 11, 134, 241,
  42, 240, 70, 125,
])
const BY = new Uint8Array([
  182, 49, 77, 29, 208, 97, 13, 67, 215, 31, 43, 58, 206, 144, 184, 226, 234,
  211, 221, 13, 122, 249, 57, 24, 247, 245, 189, 60, 43, 92, 100, 3,
])
const QY = new Uint8Array([
  151, 94, 17, 179, 57, 217, 213, 62, 110, 220, 73, 144, 86, 240, 227, 11, 112,
  81, 212, 165, 123, 241, 71, 112, 204, 102, 28, 156, 156, 31, 89, 151, 198, 10,
  64, 181, 50, 221, 218, 61, 60, 136, 28, 199, 0, 240, 231, 2, 34, 11, 211, 240,
  43, 253, 64, 38,
])
const NEKO_KEY_HEX =
  '91c818cf3d725fba7dee5af0bc2be19893ff7b4bb1159cd80e92637a74bcb5f3'
const SHIBUYA_KEY_HEX =
  '0e8601be4cbcfb2c79dd5dd3d0d4563d5c89d2962c89263e5e8416583119c6fa'

interface TmdbMeta {
  imdbId?: string
  title: string
  year: number
}

interface SignedRequest {
  'X-PS-Sig': string
  _pk: string
  z: string
}

function isValidTmdbId(tmdbId: string): boolean {
  return /^\d+$/.test(tmdbId)
}

function isValidEpisodeNumber(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

async function lookupTmdbMeta(
  tmdbId: string,
  mediaType: 'movie' | 'tv'
): Promise<TmdbMeta | null> {
  const apiKey = process.env.TMDB_API_KEY?.trim()
  if (!apiKey) return null

  try {
    const params = new URLSearchParams({ api_key: apiKey })
    const response = await fetch(
      `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?${params}`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    )
    if (!response.ok) return null

    const payload = (await response.json()) as {
      title?: string
      name?: string
      release_date?: string
      first_air_date?: string
      imdb_id?: string
    }

    let imdbId = payload.imdb_id?.trim()
    if (!imdbId && mediaType === 'tv') {
      const extResponse = await fetch(
        `https://api.themoviedb.org/3/tv/${tmdbId}/external_ids?${params}`,
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
      )
      if (extResponse.ok) {
        const ext = (await extResponse.json()) as { imdb_id?: string }
        imdbId = ext.imdb_id?.trim()
      }
    }

    const dateString = payload.release_date || payload.first_air_date || ''
    const year = Number(dateString.slice(0, 4))
    const title = payload.title || payload.name || ''
    if (!title) return null

    return {
      ...(imdbId && /^tt\d{5,}$/i.test(imdbId) ? { imdbId } : {}),
      title,
      year: Number.isFinite(year) && year > 0 ? year : 0,
    }
  } catch {
    return null
  }
}

function xorMask(mask: Uint8Array, stream: Buffer): Buffer {
  return Buffer.from(
    mask.map((value, index) => value ^ stream[index % stream.length])
  )
}

function keyStream(length: number): Buffer {
  const seed = createHash('sha256')
    .update(`${SEED_TEXT}:${SIGNATURE_HOSTNAME}`, 'utf8')
    .digest()
  const out = Buffer.alloc(length)
  let offset = 0
  let counter = 0
  while (offset < length) {
    const block = createHash('sha256')
      .update(Buffer.concat([seed, Buffer.from([counter])]))
      .digest()
    block.copy(out, offset)
    offset += block.length
    counter++
  }
  return out.subarray(0, length)
}

function buildSignedRequest(
  ref: string,
  shelf: string,
  slot: string
): SignedRequest {
  const stream = keyStream(32)
  const sigKey = xorMask(KY, stream)
  const encKey = xorMask(BY, stream)
  const shortKey = xorMask(QY, stream)

  const bucket = Math.floor(Date.now() / 1000 / 10800)
  const signature = createHmac('sha256', sigKey)
    .update(`${ref}|${shelf}|${slot}|${bucket}`)
    .digest('hex')

  const iv = randomBytes(12)
  const nonce = randomBytes(16).toString('hex')
  const plaintext = JSON.stringify({
    t: ref,
    x: Math.floor(Date.now() / 1000),
    n: nonce,
  })
  const cipher = createCipheriv('aes-256-gcm', encKey, iv)
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ])

  return {
    'X-PS-Sig': signature,
    _pk: Buffer.concat([iv, encrypted]).toString('hex'),
    z: createHmac('sha256', shortKey)
      .update(`${ref}:${bucket}`)
      .digest('hex')
      .slice(0, 10),
  }
}

function decryptAesGcm(keyHex: string, payload: string): string | null {
  try {
    const raw = Buffer.from(payload, 'hex')
    if (raw.length < 28) return null
    const iv = raw.subarray(0, 12)
    const encrypted = raw.subarray(12, -16)
    const authTag = raw.subarray(-16)
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(keyHex, 'hex'),
      iv
    )
    decipher.setAuthTag(authTag)
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return null
  }
}

function streamUrl(value: string | undefined): URL | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function playbackHeaders(
  provided?: Record<string, string>
): Record<string, string> {
  if (provided && Object.keys(provided).length > 0) {
    return { Accept: '*/*', ...provided }
  }
  return {
    Accept: '*/*',
    Referer: `${ZSTREAM_ORIGIN}/`,
    'User-Agent': USER_AGENT,
  }
}

function buildLink(
  name: string,
  url: string,
  headers?: Record<string, string>,
  streamType?: string
): ProviderLink | null {
  const parsed = streamUrl(url)
  if (!parsed) return null
  const type = streamType?.toLowerCase() || ''
  const isM3U8 = type === 'hls' || /\.m3u8(?:$|[?#])/i.test(parsed.href)
  const isDASH = type === 'dash' || /\.mpd(?:$|[?#])/i.test(parsed.href)
  return {
    server: `ZStream | ${name}`,
    url: parsed.href,
    isM3U8,
    ...(isDASH ? { isDASH: true } : {}),
    quality: 'auto',
    subtitles: [],
    headers: playbackHeaders(headers),
    requiresProxy: true,
  }
}

async function signedLookup(
  path: string,
  query: Record<string, string>
): Promise<Record<string, unknown> | null> {
  const {
    'X-PS-Sig': sig,
    _pk,
    z,
  } = buildSignedRequest(
    query.tmdbId,
    query.seasonId || '',
    query.episodeId || ''
  )

  const params = new URLSearchParams({ ...query, _pk, z })
  const response = await fetch(`${FONTAINE_BASE}${path}?${params}`, {
    headers: { ...LOOKUP_HEADERS, 'X-PS-Sig': sig },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (response.status === 404) {
    await response.body?.cancel()
    return null
  }
  if (!response.ok) {
    const details = (await response.text()).slice(0, 300)
    throw new Error(
      `${path} lookup failed with HTTP ${response.status}${
        details ? `: ${details}` : ''
      }`
    )
  }
  return (await response.json()) as Record<string, unknown>
}

async function nekoStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  const query: Record<string, string> = {
    type: mediaType === 'movie' ? 'movie' : 'tv',
    tmdbId,
  }
  if (mediaType === 'tv') {
    query.seasonId = String(season)
    query.episodeId = String(episode)
  }

  const payload = await signedLookup('/Neko', query)
  const neko = payload?.sources as
    | {
        Neko?: {
          url?: string
          headers?: Record<string, string>
          type?: string
        }
      }
    | undefined
  const entry = neko?.Neko
  if (!entry?.url) return []

  // Mirror the client: only the `nk_` prefixed payloads are encrypted, and
  // any other URL is used as-is.
  const decrypted = entry.url.startsWith('nk_')
    ? decryptAesGcm(NEKO_KEY_HEX, entry.url.slice(3))
    : entry.url
  if (!decrypted) return []

  const link = buildLink('Neko 🐱', decrypted, entry.headers, entry.type)
  return link ? [link] : []
}

async function shibuyaStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  const meta = await lookupTmdbMeta(tmdbId, mediaType)
  if (!meta) return []

  const query: Record<string, string> = {
    type: mediaType === 'movie' ? 'movie' : 'tv',
    tmdbId,
    t: meta.title,
    ...(meta.year > 0 ? { ry: String(meta.year) } : {}),
  }
  if (meta.imdbId) query.imdbId = meta.imdbId
  if (mediaType === 'tv') {
    query.seasonId = String(season)
    query.episodeId = String(episode)
  }

  const payload = await signedLookup('/shibuya', query)
  const streams = Array.isArray(payload?.streams) ? payload.streams : []

  return streams.flatMap((entry): ProviderLink[] => {
    const value = entry as {
      url?: string
      headers?: Record<string, string>
      type?: string
    }
    if (typeof value.url !== 'string') return []
    // Mirror the client: only the `sb_` prefixed payloads are encrypted.
    const decrypted = value.url.startsWith('sb_')
      ? decryptAesGcm(SHIBUYA_KEY_HEX, value.url.slice(3))
      : value.url
    if (!decrypted) return []
    const link = buildLink('Shibuya 🌸', decrypted, value.headers, value.type)
    return link ? [link] : []
  })
}

async function vaultStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  const meta = await lookupTmdbMeta(tmdbId, mediaType)
  if (!meta?.imdbId) return []

  const params = new URLSearchParams({
    tmdbId,
    imdbId: meta.imdbId,
    type: mediaType === 'movie' ? 'movie' : 'tv',
  })
  if (mediaType === 'tv') {
    params.set('seasonId', String(season))
    params.set('episodeId', String(episode))
  }

  const response = await fetch(`${FONTAINE_BASE}/vault?${params}`, {
    headers: LOOKUP_HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

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

  const payload = (await response.json()) as {
    sources?: Record<string, { url?: string; type?: string }>
  }

  return Object.entries(payload.sources ?? {}).flatMap(([name, entry]) => {
    const link = buildLink(
      `Vault · ${name}`,
      entry.url || '',
      undefined,
      entry.type
    )
    return link ? [link] : []
  })
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

  const results = await Promise.allSettled([
    nekoStreams(tmdbId, mediaType, season, episode),
    shibuyaStreams(tmdbId, mediaType, season, episode),
    vaultStreams(tmdbId, mediaType, season, episode),
  ])

  const links: ProviderLink[] = []
  results.forEach((result, index) => {
    const source = ['Neko', 'Shibuya', 'Vault'][index]
    if (result.status === 'fulfilled') {
      links.push(...result.value)
      return
    }
    console.warn(
      `[ZStream:${source}] ${result.reason instanceof Error ? result.reason.message : 'Source failed'}`
    )
  })

  return Array.from(new Map(links.map(link => [link.url, link])).values())
}

export const zstreamProvider: Provider = {
  name: 'ZStream',
  id: 'zstream',
  alias: 'Axum',
  streamMovie: tmdbId =>
    withForcedForwardProxy(() => lookupStreams(tmdbId, 'movie')),
  streamTV: (tmdbId, season, episode) =>
    withForcedForwardProxy(() => lookupStreams(tmdbId, 'tv', season, episode)),
}
