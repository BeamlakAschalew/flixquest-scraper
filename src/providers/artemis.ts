import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto'
import type { Provider, ProviderLink } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'

// Protocol and repair notes: ./ARTEMIS_MAINTENANCE.md
const ARTEMIS_API_BASE = 'https://artemis.fontaine.lol'
const ZSTREAM_ORIGIN = 'https://zstream.mov'
const REQUEST_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS
const SIGNATURE_WINDOW_SECONDS = 90
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'

// These are public client constants reconstructed from ZStream's production
// bundle. They are expected to rotate; update the maintenance document too.
const PROOF_SIGNATURE_KEY = Buffer.from(
  '287a70ec1a95bd245c294103ba586301d0da41c1dd03057c2fe14ae34ac85782',
  'hex'
)
const PROOF_ENCRYPTION_KEY = Buffer.from(
  '60ee98763acda96a682d3cccc180dabecc1193cfce9556cdf9e0246da916e775',
  'hex'
)
const SHORT_SIGNATURE_KEY = Buffer.from(
  'a7213741d9be938b1dfc358e802a615bdeddb7a13b6aa3ee840e9014e6e4db05',
  'hex'
)
const LOOKUP_SIGNATURE_KEY = Buffer.from(
  'f8dccaefd1952960af896e01cda3c7d6f2076eea38dcf4e162a2480b6b02cdc6',
  'hex'
)
const RESPONSE_ENCRYPTION_KEY = Buffer.from(
  'b9f74f0d4cb6e19e4101a132f3b09a468d680119bb4bf7b4781d3b9aad09f59b',
  'hex'
)

const LOOKUP_HEADERS = {
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: `${ZSTREAM_ORIGIN}/`,
  'Sec-CH-UA': '"Not.A/Brand";v="99", "Chromium";v="136"',
  'Sec-CH-UA-Mobile': '?0',
  'Sec-CH-UA-Platform': '"macOS"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'cross-site',
  'User-Agent': USER_AGENT,
}

const PLAYBACK_HEADERS = {
  Accept: '*/*',
  Origin: ZSTREAM_ORIGIN,
  Referer: `${ZSTREAM_ORIGIN}/`,
  'User-Agent': USER_AGENT,
}

interface ArtemisVariant {
  fid?: string
  name?: string
  quality?: string | number
  codec?: string
  tag?: string
  type?: string
  url?: string
}

interface ArtemisLookupPayload {
  tmdb_id?: string
  quality?: string
  quality_t?: number
  variants?: ArtemisVariant[]
}

interface ArtemisEncryptedResponse {
  d?: string
}

interface LookupContext {
  tmdbId: string
  season?: number
  episode?: number
}

function hmacHex(key: Buffer, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex')
}

function currentSignatureWindow(): number {
  return Math.floor(Date.now() / 1000 / SIGNATURE_WINDOW_SECONDS)
}

function createEncryptedProof(tmdbId: string): string {
  const iv = randomBytes(12)
  const nonce = randomBytes(16).toString('hex')
  const plaintext = JSON.stringify({
    t: tmdbId,
    x: Math.floor(Date.now() / 1000),
    n: nonce,
  })
  const cipher = createCipheriv('aes-256-gcm', PROOF_ENCRYPTION_KEY, iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])

  // WebCrypto's AES-GCM output is ciphertext followed by the 16-byte tag.
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString('hex')
}

function decryptLookupPayload(encryptedHex: string): ArtemisLookupPayload {
  if (!/^[a-f\d]+$/i.test(encryptedHex) || encryptedHex.length % 2 !== 0) {
    throw new Error('Artemis returned a malformed encrypted payload')
  }

  const encrypted = Buffer.from(encryptedHex, 'hex')
  if (encrypted.length <= 28) {
    throw new Error('Artemis returned a truncated encrypted payload')
  }

  const iv = encrypted.subarray(0, 12)
  const authTag = encrypted.subarray(encrypted.length - 16)
  const ciphertext = encrypted.subarray(12, encrypted.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', RESPONSE_ENCRYPTION_KEY, iv)
  decipher.setAuthTag(authTag)

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8')
  return JSON.parse(plaintext) as ArtemisLookupPayload
}

function absoluteStreamUrl(value: string): string {
  return new URL(value, `${ARTEMIS_API_BASE}/`).href
}

function variantQuality(variant: ArtemisVariant): string {
  if (variant.quality !== undefined && String(variant.quality).trim()) {
    return String(variant.quality)
  }
  return variant.name?.trim() || 'Unknown'
}

function variantServer(variant: ArtemisVariant, index: number): string {
  const details = [variant.name, variant.tag, variant.codec]
    .map(value => value?.trim())
    .filter((value): value is string => Boolean(value))
  return details.length > 0
    ? `Artemis - ${Array.from(new Set(details)).join(' · ')}`
    : `Artemis ${index + 1}`
}

async function lookupStreams(context: LookupContext): Promise<ProviderLink[]> {
  const season = context.season === undefined ? '' : String(context.season)
  const episode = context.episode === undefined ? '' : String(context.episode)
  const window = currentSignatureWindow()
  const params = new URLSearchParams({
    tmdbId: context.tmdbId,
    ...(season ? { seasonId: season, episodeId: episode } : {}),
    _pk: createEncryptedProof(context.tmdbId),
    z: hmacHex(SHORT_SIGNATURE_KEY, `${context.tmdbId}:${window}`).slice(0, 10),
  })

  // X-AR-Sig covers the exact encoded query string, including key order.
  params.sort()
  const query = params.toString()
  const response = await fetch(`${ARTEMIS_API_BASE}/lookup?${query}`, {
    method: 'GET',
    headers: {
      ...LOOKUP_HEADERS,
      'X-PS-Sig': hmacHex(
        PROOF_SIGNATURE_KEY,
        `${context.tmdbId}|${season}|${episode}|${window}`
      ),
      'X-AR-Sig': hmacHex(LOOKUP_SIGNATURE_KEY, query),
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    const details = (await response.text()).slice(0, 300)
    throw new Error(
      `Artemis lookup failed with HTTP ${response.status}${
        details ? `: ${details}` : ''
      }`
    )
  }

  const encrypted = (await response.json()) as ArtemisEncryptedResponse
  if (!encrypted.d) {
    throw new Error('Artemis lookup response did not contain encrypted data')
  }

  const payload = decryptLookupPayload(encrypted.d)
  const variants = Array.isArray(payload.variants) ? payload.variants : []

  return variants.flatMap((variant, index): ProviderLink[] => {
    if (!variant.url) return []

    let url: string
    try {
      url = absoluteStreamUrl(variant.url)
    } catch {
      return []
    }

    const type = variant.type?.toLowerCase()
    return [
      {
        server: variantServer(variant, index),
        url,
        isM3U8: type !== 'mp4' || /\.m3u8(?:$|[?#])/i.test(url),
        quality: variantQuality(variant),
        subtitles: [],
        headers: PLAYBACK_HEADERS,
        requiresProxy: true,
      },
    ]
  })
}

export const artemisProvider: Provider = {
  name: 'ZStream | Artemis',
  id: 'artemis',
  streamMovie: tmdbId => lookupStreams({ tmdbId }),
  streamTV: (tmdbId, season, episode) =>
    lookupStreams({ tmdbId, season, episode }),
}
