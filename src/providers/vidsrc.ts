import type { Provider, ProviderLink, Subtitle } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'

const API_BASE_URL = 'https://data.vidsrcme.ru/api.php'
const PLAYER_ORIGIN = 'https://cloudorchestranova.com'
const REQUEST_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'

const API_HEADERS = {
  Accept: 'application/json',
  Origin: PLAYER_ORIGIN,
  Referer: `${PLAYER_ORIGIN}/`,
  'User-Agent': USER_AGENT,
}

const PLAYBACK_HEADERS = {
  Accept: '*/*',
  Origin: PLAYER_ORIGIN,
  Referer: `${PLAYER_ORIGIN}/`,
  'User-Agent': USER_AGENT,
}

interface VidSrcSubtitle {
  file?: string
  url?: string
  src?: string
  label?: string
  lang?: string
  language?: string
  kind?: string
  default?: boolean
}

interface VidSrcData {
  stream_urls?: string | string[]
  default_subs?: VidSrcSubtitle[]
  subtitles?: VidSrcSubtitle[]
}

interface VidSrcWasmConfig {
  w?: number | string
  wasm_url?: string
  wasm?: string
}

interface VidSrcResponse {
  status_code?: number | string
  status?: number | string
  data?: VidSrcData
  default_subs?: VidSrcSubtitle[]
  subtitles?: VidSrcSubtitle[]
  vs?: VidSrcWasmConfig
}

// VidSrc rotates the small decryptor once per time window. Compiling is more
// expensive than instantiating, so reuse a compiled module within that window.
const wasmModuleCache = new Map<string, Promise<WebAssembly.Module>>()

async function fetchChecked(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    const failedUrl = new URL(response.url || url)
    throw new Error(
      `HTTP ${response.status} from ${failedUrl.hostname}${failedUrl.pathname}`
    )
  }
  return response
}

function decodeBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}

function validatedWasmUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== 'data.vidsrcme.ru') {
    throw new Error('VidSrc returned an unexpected WASM URL')
  }
  return url.href
}

function compileWasm(config: VidSrcWasmConfig): Promise<WebAssembly.Module> {
  const cacheKey = String(config.w ?? config.wasm_url ?? config.wasm ?? '')
  const existing = wasmModuleCache.get(cacheKey)
  if (existing) return existing

  const compiled = (async () => {
    let bytes: Uint8Array
    if (config.wasm_url) {
      const response = await fetchChecked(validatedWasmUrl(config.wasm_url), {
        headers: { Accept: 'application/wasm', 'User-Agent': USER_AGENT },
      })
      bytes = new Uint8Array(await response.arrayBuffer())
    } else if (config.wasm) {
      bytes = decodeBase64(config.wasm)
    } else {
      throw new Error('VidSrc response did not include a decryptor')
    }

    // TypeScript's Node typings expose Uint8Array.buffer as ArrayBufferLike;
    // WebAssembly.compile requires an ArrayBuffer-backed BufferSource.
    const binary = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer
    return WebAssembly.compile(binary)
  })()

  // Only the current and immediately previous windows are useful.
  wasmModuleCache.set(cacheKey, compiled)
  while (wasmModuleCache.size > 2) {
    const oldestKey = wasmModuleCache.keys().next().value
    if (oldestKey !== undefined) wasmModuleCache.delete(oldestKey)
  }
  compiled.catch(() => wasmModuleCache.delete(cacheKey))
  return compiled
}

async function decryptStreamUrls(
  encrypted: string,
  config?: VidSrcWasmConfig
): Promise<string[]> {
  if (!config) throw new Error('VidSrc encrypted streams have no decryptor')

  const module = await compileWasm(config)
  const instance = await WebAssembly.instantiate(module, {})
  const memory = instance.exports.memory
  const allocate = instance.exports.alloc
  const decrypt = instance.exports.decrypt
  if (
    !(memory instanceof WebAssembly.Memory) ||
    typeof allocate !== 'function' ||
    typeof decrypt !== 'function'
  ) {
    throw new Error('VidSrc decryptor has invalid exports')
  }

  const bytes = decodeBase64(encrypted)
  const pointer = allocate(bytes.length) as number
  new Uint8Array(memory.buffer, pointer, bytes.length).set(bytes)
  const outputLength = decrypt(pointer, bytes.length) as number
  if (!Number.isSafeInteger(outputLength) || outputLength < 0) {
    throw new Error('VidSrc decryptor returned an invalid length')
  }

  const outputStart = pointer + 12
  if (outputStart + outputLength > memory.buffer.byteLength) {
    throw new Error('VidSrc decryptor output exceeded its memory')
  }
  const text = new TextDecoder().decode(
    new Uint8Array(memory.buffer, outputStart, outputLength)
  )
  return text
    .split('\n')
    .map(value => value.trim())
    .filter(Boolean)
}

function normalizeSubtitles(response: VidSrcResponse): Subtitle[] {
  const entries = [
    ...(response.default_subs || []),
    ...(response.subtitles || []),
    ...(response.data?.default_subs || []),
    ...(response.data?.subtitles || []),
  ]

  return Array.from(
    new Map(
      entries.flatMap(entry => {
        const value = entry.file || entry.url || entry.src
        if (!value) return []
        try {
          const url = new URL(value)
          if (!['http:', 'https:'].includes(url.protocol)) return []
          const subtitle: Subtitle = {
            file: url.href,
            label: entry.label || entry.language || entry.lang || 'Unknown',
            kind: entry.kind || 'captions',
            ...(entry.default === undefined
              ? {}
              : { default: Boolean(entry.default) }),
          }
          return [[`${subtitle.file}\n${subtitle.label}`, subtitle] as const]
        } catch {
          return []
        }
      })
    ).values()
  )
}

async function addHostTokens(streamUrls: string[]): Promise<string[]> {
  const tokenByOrigin = new Map<string, Promise<string>>()

  const getToken = (origin: string): Promise<string> => {
    const existing = tokenByOrigin.get(origin)
    if (existing) return existing
    const pending = fetchChecked(`${origin}/generate.php`, {
      headers: PLAYBACK_HEADERS,
    })
      .then(response => response.text())
      .then(value => value.trim())
      .catch(() => '')
    tokenByOrigin.set(origin, pending)
    return pending
  }

  return Promise.all(
    streamUrls.map(async value => {
      const url = new URL(value)
      const token = await getToken(url.origin)
      if (!token) return url.href
      if (url.href.includes('__TOKEN__')) {
        return url.href.replaceAll('__TOKEN__', encodeURIComponent(token))
      }
      url.searchParams.set('token', token)
      return url.href
    })
  )
}

function normalizeQuality(url: URL): string {
  const match = url.pathname.match(
    /(?:^|[/_-])(2160|1080|720|480|360)p?(?:[/_.-]|$)/i
  )
  return match ? `${match[1]}p` : 'auto'
}

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
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

    const apiUrl = new URL(API_BASE_URL)
    apiUrl.searchParams.set('type', mediaType)
    apiUrl.searchParams.set('tmdb', tmdbId)
    if (mediaType === 'tv') {
      apiUrl.searchParams.set('season', String(season))
      apiUrl.searchParams.set('episode', String(episode))
    }
    apiUrl.searchParams.set('stream_urls', '')

    const response = (await (
      await fetchChecked(apiUrl.href, { headers: API_HEADERS })
    ).json()) as VidSrcResponse
    const status = String(response.status_code ?? response.status ?? '200')
    if (status !== '200' || !response.data?.stream_urls) return []

    const rawStreams = Array.isArray(response.data.stream_urls)
      ? response.data.stream_urls
      : await decryptStreamUrls(response.data.stream_urls, response.vs)
    const validStreams = Array.from(
      new Set(
        rawStreams.flatMap(value => {
          try {
            const url = new URL(value)
            return ['http:', 'https:'].includes(url.protocol) ? [url.href] : []
          } catch {
            return []
          }
        })
      )
    )
    const streams = await addHostTokens(validStreams)
    const subtitles = normalizeSubtitles(response)

    return streams.map((value, index) => {
      const url = new URL(value)
      return {
        server: `VidSrc | Server ${index + 1}`,
        url: url.href,
        isM3U8: /\.m3u8(?:$|[?#])/i.test(url.href),
        quality: normalizeQuality(url),
        subtitles,
        headers: PLAYBACK_HEADERS,
        requiresProxy: true,
      }
    })
  } catch (error) {
    console.error(
      `[VidSrc] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const vidsrcProvider: Provider = {
  name: 'VidSrc',
  id: 'vidsrc',
  alias: 'Yeha',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
