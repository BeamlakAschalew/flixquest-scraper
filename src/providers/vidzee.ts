import { createDecipheriv, createHash } from 'node:crypto'
import type { Provider, ProviderLink, Subtitle } from '../types/index.js'

const VIDZEE_CORE_URL = 'https://core.vidzee.wtf'
const VIDZEE_PLAYER_URL = 'https://player.vidzee.wtf'
const VIDZEE_API_URL = `${VIDZEE_PLAYER_URL}/api/server`
const API_KEY_URL = `${VIDZEE_CORE_URL}/api-key`
const API_KEY_SECRET = '4f2a9c7d1e8b3a6f0d5c2e9a7b1f4d8c'
const API_KEY_CACHE_TTL_MS = 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 10_000
const FRONTEND_SCAN_LIMIT = 20
const FRONTEND_TEXT_LIMIT = 5_000_000
const SERVERS = Array.from({ length: 14 }, (_value, index) => index)
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'

const API_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: `${VIDZEE_PLAYER_URL}/`,
  Origin: VIDZEE_PLAYER_URL,
}

interface VidZeeSourceItem {
  link?: string
  name?: string
  type?: string
  language?: string
  lang?: string
  flag?: string
}

interface VidZeeTrack {
  lang?: string
  url?: string
}

interface VidZeeApiResponse {
  error?: string
  headers?: Record<string, string>
  url?: VidZeeSourceItem[]
  link?: string
  tracks?: VidZeeTrack[]
  name?: string
  type?: string
  language?: string
  lang?: string
}

interface EncryptedKeyEnvelope {
  iv?: unknown
  tag?: unknown
  authTag?: unknown
  ciphertext?: unknown
  cipherText?: unknown
  encrypted?: unknown
  encryptedKey?: unknown
  payload?: unknown
  result?: unknown
  key?: unknown
  apiKey?: unknown
  api_key?: unknown
  data?: unknown
  value?: unknown
}

let apiKeyCache: { value: string; timestamp: number } | undefined

async function request(url: URL | string): Promise<Response> {
  const response = await fetch(url, {
    headers: API_HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`)
  }
  return response
}

function decodeBase64(value: string): Buffer {
  const normalized = value
    .trim()
    .replace(/^data:[^,]+,/, '')
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return Buffer.alloc(0)
  return Buffer.from(normalized, 'base64')
}

function decryptGcm(
  iv: Buffer,
  authTag: Buffer,
  ciphertext: Buffer,
  secret: string
): string {
  if (
    ![12, 16].includes(iv.length) ||
    authTag.length !== 16 ||
    ciphertext.length === 0
  ) {
    return ''
  }

  const encryptionKeys = [createHash('sha256').update(secret).digest()]
  const utf8Secret = Buffer.from(secret, 'utf8')
  if (utf8Secret.length === 32) encryptionKeys.push(utf8Secret)
  if (/^[A-Fa-f0-9]{64}$/.test(secret)) {
    encryptionKeys.push(Buffer.from(secret, 'hex'))
  }

  for (const key of encryptionKeys) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv, {
        authTagLength: 16,
      })
      decipher.setAuthTag(authTag)
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8')
    } catch {
      // Try the next key derivation used by current/older player bundles.
    }
  }
  return ''
}

function isPlausibleApiKey(value: string): boolean {
  return (
    value.length >= 16 &&
    value.length <= 64 &&
    /^[\x21-\x7e]+$/.test(value) &&
    !/^https?:\/\//i.test(value)
  )
}

function decryptPackedApiKey(
  value: string,
  secrets: string[] = [API_KEY_SECRET]
): string {
  const encrypted = decodeBase64(value)
  if (encrypted.length <= 28) return ''

  for (const secret of secrets) {
    for (const ivLength of [12, 16]) {
      // Original VidZee layout: IV + auth tag + ciphertext.
      const original = decryptGcm(
        encrypted.subarray(0, ivLength),
        encrypted.subarray(ivLength, ivLength + 16),
        encrypted.subarray(ivLength + 16),
        secret
      )
      if (isPlausibleApiKey(original)) return original

      // Standard WebCrypto layout: IV + ciphertext + auth tag.
      const standard = decryptGcm(
        encrypted.subarray(0, ivLength),
        encrypted.subarray(-16),
        encrypted.subarray(ivLength, -16),
        secret
      )
      if (isPlausibleApiKey(standard)) return standard
    }
  }
  return ''
}

function decryptKeyCandidate(value: string, secrets: string[]): string {
  const decrypted = decryptPackedApiKey(value, secrets)
  if (decrypted) return decrypted
  return isPlausibleApiKey(value) && value.length <= 32 ? value : ''
}

function decryptKeyEnvelope(
  envelope: EncryptedKeyEnvelope,
  secrets: string[]
): string {
  const iv = typeof envelope.iv === 'string' ? decodeBase64(envelope.iv) : null
  const tagValue = envelope.authTag ?? envelope.tag
  const cipherValue =
    envelope.ciphertext ?? envelope.cipherText ?? envelope.encrypted
  if (iv && typeof tagValue === 'string' && typeof cipherValue === 'string') {
    for (const secret of secrets) {
      const decrypted = decryptGcm(
        iv,
        decodeBase64(tagValue),
        decodeBase64(cipherValue),
        secret
      )
      if (isPlausibleApiKey(decrypted)) return decrypted
    }
  }

  for (const candidate of [
    envelope.encryptedKey,
    envelope.encrypted,
    envelope.key,
    envelope.apiKey,
    envelope.api_key,
    envelope.data,
    envelope.payload,
    envelope.result,
    envelope.value,
  ]) {
    if (typeof candidate === 'string') {
      const decrypted = decryptKeyCandidate(candidate, secrets)
      if (decrypted) return decrypted
    } else if (candidate && typeof candidate === 'object') {
      const decrypted = decryptKeyEnvelope(
        candidate as EncryptedKeyEnvelope,
        secrets
      )
      if (decrypted) return decrypted
    }
  }
  return ''
}

export function decryptApiKey(
  responseBody: string,
  additionalSecrets: string[] = []
): string {
  const body = responseBody.trim()
  if (!body) return ''
  const secrets = Array.from(new Set([API_KEY_SECRET, ...additionalSecrets]))

  try {
    const parsed = JSON.parse(body) as unknown
    if (typeof parsed === 'string') {
      return decryptKeyCandidate(parsed, secrets)
    }
    if (parsed && typeof parsed === 'object') {
      return decryptKeyEnvelope(parsed as EncryptedKeyEnvelope, secrets)
    }
  } catch {
    // The original endpoint returns the encrypted payload as plain text.
  }

  return decryptKeyCandidate(body, secrets)
}

function describeKeyResponse(body: string, contentType: string): string {
  const value = body.trim()
  if (/^\s*</.test(value)) return `HTML, ${value.length} bytes`
  try {
    const parsed = JSON.parse(value) as unknown
    if (typeof parsed === 'string') {
      return `JSON string, ${parsed.length} characters`
    }
    if (parsed && typeof parsed === 'object') {
      return `JSON object with fields: ${Object.keys(parsed).slice(0, 8).join(', ') || '(none)'}`
    }
  } catch {
    // Plain text is the legacy response format.
  }
  return `${contentType || 'plain text'}, ${value.length} characters`
}

export function decryptStreamUrl(
  encryptedLink: string,
  apiKey: string
): string {
  // VidZee used plaintext URLs before introducing encryption. Keeping this
  // fallback makes the adapter compatible during server-by-server rollouts.
  if (/^https?:\/\//i.test(encryptedLink)) return encryptedLink

  try {
    const decoded = Buffer.from(encryptedLink, 'base64').toString('utf8')
    const separator = decoded.indexOf(':')
    if (separator < 1) return ''

    const iv = Buffer.from(decoded.slice(0, separator), 'base64')
    const ciphertext = Buffer.from(decoded.slice(separator + 1), 'base64')
    if (iv.length !== 16 || ciphertext.length === 0) return ''

    const key = Buffer.alloc(32)
    key.write(apiKey, 'utf8')
    const decipher = createDecipheriv('aes-256-cbc', key, iv)
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return ''
  }
}

function extractCandidateSecrets(text: string): string[] {
  const candidates = new Set<string>()
  for (const match of text.matchAll(/["'`]([^"'`\r\n\\]{20,96})["'`]/g)) {
    const value = match[1]?.trim()
    if (
      value &&
      !/\s/.test(value) &&
      !/\.(?:js|css|json|png|jpe?g|svg|woff2?)$/i.test(value)
    ) {
      candidates.add(value)
    }
  }
  for (const match of text.matchAll(/\b[A-Fa-f0-9]{32,64}\b/g)) {
    if (match[0]) candidates.add(match[0])
  }
  return Array.from(candidates).slice(0, 5_000)
}

function extractFrontendUrls(text: string, baseUrl: string): string[] {
  const urls = new Set<string>()
  const patterns = [
    /<script[^>]+src=["']([^"']+)["']/gi,
    /["']([^"']+\.js(?:\?[^"']*)?)["']/gi,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      try {
        const url = new URL(match[1] || '', baseUrl)
        if (
          url.protocol === 'https:' &&
          (url.hostname === 'vidzee.wtf' ||
            url.hostname.endsWith('.vidzee.wtf'))
        ) {
          urls.add(url.href)
        }
      } catch {
        // Ignore malformed asset references.
      }
    }
  }
  return Array.from(urls)
}

async function discoverRotatingApiKey(
  responseBody: string,
  tmdbId: string,
  season?: number,
  episode?: number
): Promise<string> {
  const embedPath =
    season !== undefined && episode !== undefined
      ? `/v2/embed/tv/${encodeURIComponent(tmdbId)}/${season}/${episode}?sr=4`
      : `/v2/embed/movie/${encodeURIComponent(tmdbId)}?sr=4`
  const queue = [
    new URL(embedPath, VIDZEE_PLAYER_URL).href,
    `${VIDZEE_PLAYER_URL}/`,
    `${VIDZEE_CORE_URL}/`,
  ]
  const visited = new Set<string>()

  while (queue.length > 0 && visited.size < FRONTEND_SCAN_LIMIT) {
    const url = queue.shift()
    if (!url || visited.has(url)) continue
    visited.add(url)

    try {
      const response = await fetch(url, {
        headers: {
          ...API_HEADERS,
          Accept: 'text/html,application/javascript,*/*;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) {
        await response.body?.cancel()
        continue
      }

      const text = (await response.text()).slice(0, FRONTEND_TEXT_LIMIT)
      const key = decryptApiKey(responseBody, extractCandidateSecrets(text))
      if (key) return key

      for (const discoveredUrl of extractFrontendUrls(
        text,
        response.url || url
      )) {
        if (!visited.has(discoveredUrl) && queue.length < FRONTEND_SCAN_LIMIT) {
          queue.push(discoveredUrl)
        }
      }
    } catch {
      // A missing optional bundle should not abort the remaining candidates.
    }
  }
  return ''
}

async function getApiKey(
  tmdbId: string,
  season?: number,
  episode?: number
): Promise<string> {
  if (
    apiKeyCache &&
    Date.now() - apiKeyCache.timestamp < API_KEY_CACHE_TTL_MS
  ) {
    return apiKeyCache.value
  }

  const response = await request(API_KEY_URL)
  const responseBody = await response.text()
  const key =
    decryptApiKey(responseBody) ||
    (await discoverRotatingApiKey(responseBody, tmdbId, season, episode))
  if (!key) {
    throw new Error(
      `VidZee returned an unsupported API-key response (${describeKeyResponse(responseBody, response.headers.get('content-type') || '')})`
    )
  }
  apiKeyCache = { value: key, timestamp: Date.now() }
  return key
}

function playbackHeaders(
  url: string,
  responseHeaders?: Record<string, string>
): Record<string, string> | undefined {
  if (/serversicuro\.cc/i.test(url)) return undefined

  const responseUserAgent = Object.entries(responseHeaders || {}).find(
    ([name]) => name.toLowerCase() === 'user-agent'
  )?.[1]
  if (/fast33lane/i.test(url)) {
    return {
      Referer: 'https://rapidairmax.site/',
      Origin: 'https://rapidairmax.site',
      'User-Agent': responseUserAgent || USER_AGENT,
    }
  }

  return {
    Referer: `${VIDZEE_CORE_URL}/`,
    Origin: VIDZEE_CORE_URL,
    'User-Agent': responseUserAgent || USER_AGENT,
  }
}

function mapSubtitles(tracks: VidZeeTrack[] | undefined): Subtitle[] {
  return (tracks || []).flatMap((track, index) => {
    if (!track.url) return []
    return [
      {
        file: track.url,
        label:
          track.lang?.replace(/\d+/g, '').trim() || `Subtitle ${index + 1}`,
        kind: 'captions',
      },
    ]
  })
}

async function getStreamsFromServer(
  tmdbId: string,
  server: number,
  apiKey: string,
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  const apiUrl = new URL(VIDZEE_API_URL)
  apiUrl.searchParams.set('id', tmdbId)
  apiUrl.searchParams.set('sr', String(server))
  if (season !== undefined && episode !== undefined) {
    apiUrl.searchParams.set('ss', String(season))
    apiUrl.searchParams.set('ep', String(episode))
  }

  try {
    const data = (await (await request(apiUrl)).json()) as VidZeeApiResponse
    if (data.error) return []

    const sources = Array.isArray(data.url)
      ? data.url
      : data.link
        ? [
            {
              link: data.link,
              name: data.name,
              type: data.type,
              language: data.language || data.lang,
            },
          ]
        : []
    const subtitles = mapSubtitles(data.tracks)

    return sources.flatMap(source => {
      if (!source.link) return []
      const url = decryptStreamUrl(source.link, apiKey)
      if (!/^https?:\/\//i.test(url)) return []

      const language = source.lang || source.language
      const details = [source.name, source.flag, language]
        .filter(Boolean)
        .join(' | ')
      const headers = playbackHeaders(url, data.headers)
      return [
        {
          server: `VidZee S${server}${details ? ` | ${details}` : ''}`,
          url,
          isM3U8: source.type === 'hls' || /\.m3u8(?:$|[?#])/i.test(url),
          quality: source.name?.match(/\b\d{3,4}p?\b/i)?.[0] || 'auto',
          subtitles,
          ...(headers && { headers }),
        } satisfies ProviderLink,
      ]
    })
  } catch (error) {
    console.warn(
      `[VidZee S${server}] Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return []
  }
}

async function getVidZeeStreams(
  tmdbId: string,
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  try {
    const apiKey = await getApiKey(tmdbId, season, episode)
    const results = await Promise.all(
      SERVERS.map(server =>
        getStreamsFromServer(tmdbId, server, apiKey, season, episode)
      )
    )
    return Array.from(
      new Map(results.flat().map(link => [link.url, link])).values()
    )
  } catch (error) {
    console.error(
      `[VidZee] Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return []
  }
}

export const vidzeeProvider: Provider = {
  name: 'VidZee',
  id: 'vidzee',
  streamMovie: tmdbId => getVidZeeStreams(tmdbId),
  streamTV: (tmdbId, season, episode) =>
    getVidZeeStreams(tmdbId, season, episode),
}
