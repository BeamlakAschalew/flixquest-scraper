/* eslint-disable no-unused-vars */
import { readFile } from 'node:fs/promises'
import type { Provider, ProviderLink, Subtitle } from '../types/index.js'

const VIDZEE_CORE_URL = 'https://core.vidzee.wtf'
const VIDZEE_PLAYER_URL = 'https://player.vidzee.wtf'
const VIDZEE_PLAYER_HOSTNAME = new URL(VIDZEE_PLAYER_URL).hostname
const REQUEST_TIMEOUT_MS = 20_000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'

const REQUEST_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  Origin: VIDZEE_PLAYER_URL,
  Referer: `${VIDZEE_PLAYER_URL}/`,
  'User-Agent': USER_AGENT,
}

const SERVERS = [
  { id: 'tik', label: 'TCloud' },
  { id: 'ipcloud', label: 'IPcloud' },
  { id: 'v6:Hindi', label: 'Hindi v3' },
] as const

interface VidZeeStreamPayload {
  c?: string
  error?: string
  headers?: Record<string, string>
  language?: string
  url?: string
}

interface VidZeeSubtitle {
  file?: string
  label?: string
  lang?: string
  language?: string
  url?: string
}

interface VidZeeWasmExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory
  decrypt: (ciphertextPointer: number, hostnamePointer: number) => number
  __new: (size: number, id: number) => number
  __pin: (pointer: number) => number
  __unpin: (pointer: number) => void
}

let wasmPromise: Promise<VidZeeWasmExports> | undefined

async function requestJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: REQUEST_HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url.hostname}`)
  }
  return (await response.json()) as T
}

async function loadWasm(): Promise<VidZeeWasmExports> {
  if (wasmPromise) return wasmPromise

  wasmPromise = (async () => {
    const encoded = await readFile(
      new URL('./vidzee.wasm.b64', import.meta.url),
      'utf8'
    )
    const bytes = Buffer.from(encoded.trim(), 'base64')
    if (!bytes.length) throw new Error('VidZee decoder is empty')

    const { instance } = await WebAssembly.instantiate(bytes, {
      env: {
        abort: () => {
          throw new Error('VidZee decoder aborted')
        },
      },
    })
    return instance.exports as VidZeeWasmExports
  })()

  try {
    return await wasmPromise
  } catch (error) {
    wasmPromise = undefined
    throw error
  }
}

function writeAssemblyScriptString(
  exports: VidZeeWasmExports,
  value: string
): number {
  const pointer = exports.__new(value.length << 1, 2) >>> 0
  const memory = new Uint16Array(exports.memory.buffer)
  for (let index = 0; index < value.length; index++) {
    memory[(pointer >>> 1) + index] = value.charCodeAt(index)
  }
  return pointer
}

function writeAssemblyScriptUint8Array(
  exports: VidZeeWasmExports,
  value: Uint8Array
): number {
  const dataPointer = exports.__pin(exports.__new(value.length, 1)) >>> 0
  const arrayPointer = exports.__new(12, 6) >>> 0
  const view = new DataView(exports.memory.buffer)

  view.setUint32(arrayPointer, dataPointer, true)
  view.setUint32(arrayPointer + 4, dataPointer, true)
  view.setUint32(arrayPointer + 8, value.length, true)
  new Uint8Array(exports.memory.buffer, dataPointer, value.length).set(value)
  exports.__unpin(dataPointer)

  return arrayPointer
}

function readAssemblyScriptUint8Array(
  exports: VidZeeWasmExports,
  pointer: number
): Uint8Array | null {
  pointer >>>= 0
  if (!pointer) return null

  const view = new DataView(exports.memory.buffer)
  const dataPointer = view.getUint32(pointer + 4, true)
  const byteLength = view.getUint32(pointer + 8, true)
  if (!dataPointer || !byteLength) return null
  return new Uint8Array(exports.memory.buffer, dataPointer, byteLength).slice()
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.trim().replace(/\s+/g, '')
  if (
    !normalized ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) ||
    normalized.length % 4 !== 0
  ) {
    throw new Error('Invalid encrypted stream payload')
  }
  return Buffer.from(normalized, 'base64')
}

async function decryptStreamPayload(
  ciphertext: string
): Promise<VidZeeStreamPayload> {
  const exports = await loadWasm()
  const arrayPointer = exports.__pin(
    writeAssemblyScriptUint8Array(exports, decodeBase64(ciphertext))
  )

  try {
    const output = readAssemblyScriptUint8Array(
      exports,
      exports.decrypt(
        arrayPointer,
        writeAssemblyScriptString(exports, VIDZEE_PLAYER_HOSTNAME)
      )
    )
    if (!output) throw new Error('VidZee decoder returned no data')

    const payload = JSON.parse(
      new TextDecoder().decode(output)
    ) as VidZeeStreamPayload
    if (!payload || typeof payload !== 'object') {
      throw new Error('VidZee decoder returned an invalid payload')
    }
    return payload
  } finally {
    exports.__unpin(arrayPointer)
  }
}

function streamPath(tmdbId: string, season?: number, episode?: number): string {
  return season !== undefined && episode !== undefined
    ? `/streams/tv/${encodeURIComponent(tmdbId)}/${season}/${episode}`
    : `/streams/movie/${encodeURIComponent(tmdbId)}`
}

function subtitlePath(
  tmdbId: string,
  season?: number,
  episode?: number
): string {
  return season !== undefined && episode !== undefined
    ? `/subs/tv/${encodeURIComponent(tmdbId)}/${season}/${episode}`
    : `/subs/movie/${encodeURIComponent(tmdbId)}`
}

async function getSubtitles(
  tmdbId: string,
  season?: number,
  episode?: number
): Promise<Subtitle[]> {
  try {
    const url = new URL(subtitlePath(tmdbId, season, episode), VIDZEE_CORE_URL)
    const subtitles = await requestJson<VidZeeSubtitle[]>(url)
    if (!Array.isArray(subtitles)) return []

    return subtitles.flatMap((subtitle, index) => {
      const file = subtitle.file || subtitle.url
      if (!file || !/^https?:\/\//i.test(file)) return []
      return [
        {
          file,
          label:
            subtitle.label ||
            subtitle.language ||
            subtitle.lang ||
            `Subtitle ${index + 1}`,
          kind: 'captions',
        },
      ]
    })
  } catch (error) {
    console.warn(
      `[VidZee] Subtitle request failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return []
  }
}

function detectQuality(url: string): string {
  const match = url.match(
    /(?:^|[/_.-])(2160|1440|1080|720|480|360)(?:p|[/_.-]|$)/i
  )
  return match?.[1] ? `${match[1]}p` : 'auto'
}

async function getStreamFromServer(
  server: (typeof SERVERS)[number],
  tmdbId: string,
  subtitles: Subtitle[],
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  const url = new URL(streamPath(tmdbId, season, episode), VIDZEE_CORE_URL)
  url.searchParams.set('s', server.id)
  url.searchParams.set('e', '1')

  try {
    let payload = await requestJson<VidZeeStreamPayload>(url)
    if (payload.c && !payload.url) {
      payload = await decryptStreamPayload(payload.c)
    }
    if (!payload.url || !/^https?:\/\//i.test(payload.url)) return []

    const headers =
      payload.headers && Object.keys(payload.headers).length
        ? payload.headers
        : undefined
    return [
      {
        server: `VidZee | ${server.label}${payload.language ? ` | ${payload.language}` : ''}`,
        url: payload.url,
        isM3U8: /\.m3u8(?:$|[?#])/i.test(payload.url),
        quality: detectQuality(payload.url),
        subtitles,
        ...(headers && { headers }),
      },
    ]
  } catch (error) {
    console.warn(
      `[VidZee | ${server.label}] Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return []
  }
}

async function getVidZeeStreams(
  tmdbId: string,
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  if (!/^\d+$/.test(tmdbId)) {
    console.warn('[VidZee] TMDB ID must be numeric')
    return []
  }
  if (
    (season !== undefined && (!Number.isInteger(season) || season < 1)) ||
    (episode !== undefined && (!Number.isInteger(episode) || episode < 1))
  ) {
    console.warn('[VidZee] Season and episode must be positive integers')
    return []
  }

  const subtitles = await getSubtitles(tmdbId, season, episode)
  const results = await Promise.all(
    SERVERS.map(server =>
      getStreamFromServer(server, tmdbId, subtitles, season, episode)
    )
  )
  return Array.from(
    new Map(results.flat().map(link => [link.url, link])).values()
  )
}

export const vidzeeProvider: Provider = {
  name: 'VidZee',
  id: 'vidzee',
  alias: 'Erta Ale',
  streamMovie: tmdbId => getVidZeeStreams(tmdbId),
  streamTV: (tmdbId, season, episode) =>
    getVidZeeStreams(tmdbId, season, episode),
}
