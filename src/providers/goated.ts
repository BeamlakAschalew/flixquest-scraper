/**
 * GOATED resolver (https://goated.cx).
 *
 * The public frontend obtains a proof-of-work challenge, adds the solution to
 * the media request, and encrypts it with the current UTC date before calling
 * api.reallyfast.xyz. Resolved CDN URLs are signed and short-lived, so this
 * provider is registered as uncacheable by the API.
 */
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import type { Provider, ProviderLink, Subtitle } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'

const API_BASE_URL = 'https://api.reallyfast.xyz/api'
const RESOLVER_SECRET =
  '79eb073a697f8e22d44fdb60971efa9b1cd224fa7963f9095e48971f5e13866b'
const MAX_NONCE = 5_000_000
const REQUEST_TIMEOUT_MS = Math.min(DEFAULT_REQUEST_TIMEOUT_MS, 15_000)
const API_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  Origin: 'https://goated.cx',
  Referer: 'https://goated.cx/',
}

interface ChallengeResponse {
  challenge?: string
  difficulty?: number
}

interface ResolverSubtitle {
  url?: string
  file?: string
  label?: string
  language?: string
}

interface ResolverResponse {
  url?: string
  source?: string
  format?: string
  subtitles?: ResolverSubtitle[]
  availableSources?: string[]
}

interface ResolveRequest {
  mediaType: 'movie' | 'tv'
  id: string
  season?: number
  episode?: number
  source?: string
}

interface EncryptedRequest {
  q: string
  s: string
  t: string
  d: string
}

function isValidTmdbId(tmdbId: string): boolean {
  return /^\d+$/.test(tmdbId)
}

function isValidEpisodeNumber(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function validHttpUrl(value: string | undefined): URL | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...API_HEADERS, ...init?.headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // Keep the status-only error when the backend does not return JSON.
    }
    throw new Error(message)
  }
  return (await response.json()) as T
}

async function solveProofOfWork(
  challenge: string,
  difficulty: number
): Promise<string> {
  const prefix = '0'.repeat(difficulty)
  for (let nonce = 0; nonce <= MAX_NONCE; nonce++) {
    const digest = createHash('sha256')
      .update(`${challenge}${nonce}`)
      .digest('hex')
    if (digest.startsWith(prefix)) return String(nonce)
    if (nonce > 0 && nonce % 25_000 === 0) {
      await new Promise<void>(resolve => setImmediate(resolve))
    }
  }
  throw new Error('Proof-of-work timed out')
}

async function getProof(): Promise<{ challenge: string; nonce: string }> {
  const payload = await fetchJson<ChallengeResponse>(
    `${API_BASE_URL}/challenge`
  )
  if (
    !payload.challenge ||
    !Number.isInteger(payload.difficulty) ||
    payload.difficulty! < 0 ||
    payload.difficulty! > 64
  ) {
    throw new Error('Invalid proof-of-work challenge')
  }
  return {
    challenge: payload.challenge,
    nonce: await solveProofOfWork(payload.challenge, payload.difficulty!),
  }
}

function encryptRequest(value: object): EncryptedRequest {
  const date = new Date().toISOString().slice(0, 10)
  const key = createHash('sha256').update(`${RESOLVER_SECRET}:${date}`).digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ])
  return {
    q: ciphertext.toString('base64'),
    s: iv.toString('base64'),
    t: cipher.getAuthTag().toString('base64'),
    d: date,
  }
}

async function resolveStream(
  request: ResolveRequest
): Promise<ResolverResponse> {
  const proof = await getProof()
  return fetchJson<ResolverResponse>(`${API_BASE_URL}/resolve`, {
    method: 'POST',
    body: JSON.stringify(encryptRequest({ ...request, ...proof })),
  })
}

function subtitlesFrom(entries: ResolverSubtitle[] = []): Subtitle[] {
  return Array.from(
    new Map(
      entries.flatMap(entry => {
        const url = validHttpUrl(entry.url || entry.file)
        if (!url) return []
        const subtitle: Subtitle = {
          file: url.href,
          label: entry.label || entry.language || 'Unknown',
          kind: 'captions',
        }
        return [[`${subtitle.file}\n${subtitle.label}`, subtitle] as const]
      })
    ).values()
  )
}

function parseResolutionLadder(manifest: string): number[] {
  const heights = Array.from(
    manifest.matchAll(/RESOLUTION=\d+x(\d+)/gi),
    match => Number(match[1])
  ).filter(height => Number.isSafeInteger(height) && height > 0)
  return Array.from(new Set(heights)).sort((a, b) => a - b)
}

async function inspectHls(url: string): Promise<number[]> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) return []
    return parseResolutionLadder(await response.text())
  } catch {
    return []
  }
}

async function linkFromResponse(
  payload: ResolverResponse,
  fallbackSource?: string
): Promise<ProviderLink | null> {
  const url = validHttpUrl(payload.url)
  if (!url) return null
  const isM3U8 =
    payload.format?.toLowerCase() === 'hls' ||
    /\.m3u8(?:$|[?#])/i.test(url.href)
  const ladder = isM3U8 ? await inspectHls(url.href) : []
  const highest = ladder.at(-1)
  const source = payload.source || fallbackSource || 'Default'
  const ladderLabel = ladder.length
    ? ` | ${ladder.map(height => `${height}p`).join('/')}`
    : ''
  return {
    server: `GOATED | ${source}${ladderLabel}`,
    url: url.href,
    isM3U8,
    isDASH:
      payload.format?.toLowerCase() === 'dash' ||
      /\.mpd(?:$|[?#])/i.test(url.href),
    quality: highest ? `${highest}p` : 'auto',
    subtitles: subtitlesFrom(payload.subtitles),
  }
}

function mergeSubtitles(links: ProviderLink[]): ProviderLink[] {
  const subtitles = Array.from(
    new Map(
      links.flatMap(link =>
        link.subtitles.map(
          subtitle => [`${subtitle.file}\n${subtitle.label}`, subtitle] as const
        )
      )
    ).values()
  )
  return links.map(link => ({ ...link, subtitles }))
}

async function getStreams(
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

  const baseRequest: ResolveRequest = {
    mediaType,
    id: tmdbId,
    ...(mediaType === 'tv' ? { season, episode } : {}),
  }

  try {
    const initial = await resolveStream(baseRequest)
    const sourceNames = Array.from(
      new Set(
        (initial.availableSources || []).filter(
          source => typeof source === 'string' && source.trim()
        )
      )
    )
    const activeSource = initial.source?.toLowerCase()
    const alternatives = sourceNames.filter(
      source => source.toLowerCase() !== activeSource
    )
    const resolved = await Promise.allSettled([
      Promise.resolve(initial),
      ...alternatives.map(source =>
        resolveStream({ ...baseRequest, source: source.trim() })
      ),
    ])
    const payloads = resolved.flatMap((result, index) =>
      result.status === 'fulfilled'
        ? [{ payload: result.value, fallbackSource: alternatives[index - 1] }]
        : []
    )
    const mapped = await Promise.all(
      payloads.map(({ payload, fallbackSource }) =>
        linkFromResponse(payload, fallbackSource)
      )
    )
    const links = mapped.filter((link): link is ProviderLink => link !== null)
    const unique = Array.from(
      new Map(links.map(link => [link.url, link] as const)).values()
    )
    console.log(
      `[GOATED] Extracted ${unique.length} candidate stream(s) for ${mediaType} ${tmdbId}`
    )
    return mergeSubtitles(unique)
  } catch (error) {
    console.error(
      `[GOATED] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const goatedProvider: Provider = {
  name: 'GOATED',
  id: 'goated',
  alias: 'Shire',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
