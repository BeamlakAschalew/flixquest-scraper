import type { Provider, ProviderLink } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'

const PLAYER_ORIGIN = 'https://player.vyla.cc'
const AUTH_ORIGIN = 'https://auth.vyla.cc'
const API_ORIGIN = 'https://api.vyla.cc'
const REQUEST_TIMEOUT_MS = Math.max(DEFAULT_REQUEST_TIMEOUT_MS, 35_000)
const SOURCE_KEYS = ['vidnest', 'lookmovie'] as const
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'

const PLAYBACK_HEADERS = {
  Accept: '*/*',
  Origin: PLAYER_ORIGIN,
  Referer: `${PLAYER_ORIGIN}/`,
  'User-Agent': USER_AGENT,
}

interface AuthPayload {
  token?: string
}

interface SourcePayload {
  ok?: boolean
  error?: string
  url?: string | null
  raw_url?: string | null
}

interface HlsVariant {
  url: string
  quality: string
}

function isValidTmdbId(tmdbId: string): boolean {
  return /^\d+$/.test(tmdbId)
}

function isValidEpisodeNumber(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function validHttpUrl(value: string | null | undefined): URL | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return /^https?:$/.test(url.protocol) ? url : null
  } catch {
    return null
  }
}

function qualityFromResolution(width: number, height: number): string {
  if (width >= 1900 || height >= 1000) return '1080p'
  if (width >= 1200 || height >= 650) return '720p'
  if (width >= 800 || height >= 430) return '480p'
  if (width >= 600 || height >= 300) return '360p'
  return height > 0 ? `${Math.round(height)}p` : 'auto'
}

function hlsAttribute(line: string, name: string): string | undefined {
  const match = line.match(
    new RegExp(`(?:^|,)\\s*${name}\\s*=\\s*(?:"([^"]*)"|([^,\\r\\n]*))`, 'i')
  )
  return (match?.[1] ?? match?.[2])?.trim()
}

function parseHlsVariants(manifest: string, masterUrl: string): HlsVariant[] {
  const lines = manifest.split(/\r?\n/)
  const variants: HlsVariant[] = []

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim()
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue
    const resolution = hlsAttribute(line, 'RESOLUTION')?.match(
      /^(\d+)\s*x\s*(\d+)$/i
    )
    const uri = lines
      .slice(index + 1)
      .map(candidate => candidate.trim())
      .find(candidate => candidate && !candidate.startsWith('#'))
    if (!resolution || !uri) continue

    try {
      variants.push({
        url: new URL(uri, masterUrl).href,
        quality: qualityFromResolution(
          Number(resolution[1]),
          Number(resolution[2])
        ),
      })
    } catch {
      // Ignore a malformed rendition without discarding the other variants.
    }
  }

  return Array.from(
    new Map(
      variants.map(variant => [variant.quality, variant] as const)
    ).values()
  )
}

function mp4Quality(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  for (let index = 4; index + 4 < bytes.length; index++) {
    if (
      bytes[index] !== 0x74 ||
      bytes[index + 1] !== 0x6b ||
      bytes[index + 2] !== 0x68 ||
      bytes[index + 3] !== 0x64
    ) {
      continue
    }

    const boxStart = index - 4
    const boxSize = view.getUint32(boxStart)
    if (boxSize < 16 || boxStart + boxSize > bytes.length) continue
    const width = view.getUint32(boxStart + boxSize - 8) / 65_536
    const height = view.getUint32(boxStart + boxSize - 4) / 65_536
    if (width > 0 && height > 0) return qualityFromResolution(width, height)
  }

  return 'auto'
}

async function sessionToken(): Promise<string> {
  const response = await fetch(`${AUTH_ORIGIN}/api/auth`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Origin: PLAYER_ORIGIN,
      Referer: `${PLAYER_ORIGIN}/`,
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`Vyla auth failed with HTTP ${response.status}`)
  }

  const payload = (await response.json()) as AuthPayload
  if (!payload.token) throw new Error('Vyla auth returned no session token')
  return payload.token
}

async function resolveSource(
  token: string,
  source: (typeof SOURCE_KEYS)[number],
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<SourcePayload | null> {
  const url = new URL(`/api/test/${tmdbId}`, API_ORIGIN)
  url.searchParams.set('source', source)
  if (mediaType === 'tv') {
    url.searchParams.set('season', String(season))
    url.searchParams.set('episode', String(episode))
  }

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Origin: PLAYER_ORIGIN,
        Referer: `${PLAYER_ORIGIN}/`,
        'User-Agent': USER_AGENT,
        'X-Session-Token': token,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) return null
    return (await response.json()) as SourcePayload
  } catch {
    return null
  }
}

async function inspectSource(
  source: string,
  payload: SourcePayload
): Promise<ProviderLink[]> {
  // Prefer the origin URL over Vyla's optional proxy. This keeps the public
  // result as a direct media request and avoids binding playback to a session.
  const mediaUrl = validHttpUrl(payload.raw_url) || validHttpUrl(payload.url)
  if (!mediaUrl) return []

  try {
    const response = await fetch(mediaUrl, {
      headers: { ...PLAYBACK_HEADERS, Range: 'bytes=0-65535' },
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      await response.body?.cancel()
      return []
    }

    const finalUrl = response.url || mediaUrl.href
    const bytes = new Uint8Array(await response.arrayBuffer())
    const text = new TextDecoder().decode(bytes)
    const isHls =
      /mpegurl/i.test(response.headers.get('content-type') || '') ||
      text.trimStart().startsWith('#EXTM3U')

    if (isHls) {
      const variants = parseHlsVariants(text, finalUrl)
      if (variants.length > 0) {
        return variants.map(variant => ({
          server: `Vyla | ${source} | ${variant.quality}`,
          url: variant.url,
          isM3U8: true,
          quality: variant.quality,
          subtitles: [],
          headers: PLAYBACK_HEADERS,
        }))
      }

      const qualityMatch = finalUrl.match(
        /(?:^|[/_-])(1080|720|480|360)p?(?:[/_?&.-]|$)/i
      )
      const quality = qualityMatch ? `${qualityMatch[1]}p` : 'auto'
      return [
        {
          server: `Vyla | ${source}`,
          url: finalUrl,
          isM3U8: true,
          quality,
          subtitles: [],
          headers: PLAYBACK_HEADERS,
        },
      ]
    }

    const quality = mp4Quality(bytes)
    return [
      {
        server: `Vyla | ${source}`,
        url: finalUrl,
        isM3U8: false,
        quality,
        subtitles: [],
        headers: PLAYBACK_HEADERS,
      },
    ]
  } catch {
    return []
  }
}

async function resolve(
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

  const token = await sessionToken()
  const payloads = await Promise.all(
    SOURCE_KEYS.map(async source => ({
      source,
      payload: await resolveSource(
        token,
        source,
        tmdbId,
        mediaType,
        season,
        episode
      ),
    }))
  )
  const inspected = await Promise.all(
    payloads.map(({ source, payload }) =>
      payload ? inspectSource(source, payload) : Promise.resolve([])
    )
  )

  return Array.from(
    new Map(
      inspected
        .flat()
        .map(link => [`${link.url}|${link.quality}`, link] as const)
    ).values()
  )
}

export const vylaProvider: Provider = {
  name: 'Vyla',
  id: 'vyla',
  streamMovie: tmdbId => resolve(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) => resolve(tmdbId, 'tv', season, episode),
}
