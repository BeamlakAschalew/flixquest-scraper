/* eslint-disable no-unused-vars */
import { webcrypto } from 'node:crypto'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'

const API_BASE = 'https://api.shegu.st'
const REQUEST_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS
const GATEWAY_PREFIX = 'lumen-gate-v2'
const WASM_URL = `${API_BASE}/crush.wasm`
const SEALED_REQUEST_OVERHEAD = 512
const RANDOM_BYTES = 44
const RESPONSE_KEY_BYTES = 32
const EPHEMERAL_PUBLIC_BYTES = 65
const SEALED_HEADER_BYTES = RESPONSE_KEY_BYTES + 1 + EPHEMERAL_PUBLIC_BYTES
const RESPONSE_HEADER_BYTES = 12
const GCM_TAG_BITS = 128

const GATEWAY_HEADERS = {
  Accept: '*/*',
  'Content-Type': 'text/plain;charset=UTF-8',
}

export interface CinejoyGatewayServer {
  name: string
  status?: string
  '4k'?: boolean
}

export interface CinejoyGatewayResponse {
  stream?: Array<{
    type?: string
    id?: string
    playlist?: string
    url?: string
    qualities?: Record<string, { type?: string; url?: string }>
    captions?: Array<{
      id?: string
      type?: string
      url?: string
      language?: string
      lang?: string
    }>
  }>
}

interface CrushExports {
  memory: WebAssembly.Memory
  alloc: (size: number) => number
  dealloc?: (pointer: number, size: number) => void
  seal_request: (
    requestPointer: number,
    requestLength: number,
    randomPointer: number,
    randomLength: number,
    outputPointer: number,
    outputLength: number
  ) => number
}

interface SealedRequest {
  responseKey: Uint8Array
  keyId: number
  ephemeralPublic: Uint8Array
  body: Uint8Array
}

interface GatewayEnvelope {
  status?: number
  data?: CinejoyGatewayResponse
  error?: { message?: string }
}

let crushPromise: Promise<CrushExports> | undefined

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
}

async function loadCrush(): Promise<CrushExports> {
  if (crushPromise) return crushPromise

  crushPromise = (async () => {
    const response = await fetch(WASM_URL, {
      headers: { Accept: 'application/wasm' },
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${WASM_URL}`)
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    const { instance } = await WebAssembly.instantiate(asArrayBuffer(bytes), {})
    const exports = instance.exports as unknown as Partial<CrushExports>
    if (
      !(exports.memory instanceof WebAssembly.Memory) ||
      typeof exports.alloc !== 'function' ||
      typeof exports.seal_request !== 'function'
    ) {
      throw new Error('Cinejoy crush.wasm exports changed')
    }
    return exports as CrushExports
  })()

  crushPromise.catch(() => {
    crushPromise = undefined
  })
  return crushPromise
}

async function sealRequest(
  path: string,
  payload: URLSearchParams
): Promise<SealedRequest> {
  const crush = await loadCrush()
  const request = new TextEncoder().encode(
    JSON.stringify({ path, payload: Object.fromEntries(payload.entries()) })
  )
  const random = new Uint8Array(RANDOM_BYTES)
  webcrypto.getRandomValues(random)
  const requestPointer = crush.alloc(request.byteLength) >>> 0
  const randomPointer = crush.alloc(random.byteLength) >>> 0
  const outputCapacity = request.byteLength + SEALED_REQUEST_OVERHEAD
  const outputPointer = crush.alloc(outputCapacity) >>> 0
  if (!requestPointer || !randomPointer || !outputPointer) {
    throw new Error('Cinejoy crush.wasm allocation failed')
  }

  try {
    new Uint8Array(crush.memory.buffer, requestPointer, request.byteLength).set(
      request
    )
    new Uint8Array(crush.memory.buffer, randomPointer, random.byteLength).set(
      random
    )
    const outputLength = crush.seal_request(
      requestPointer,
      request.byteLength,
      randomPointer,
      random.byteLength,
      outputPointer,
      outputCapacity
    )
    if (
      !Number.isSafeInteger(outputLength) ||
      outputLength <= SEALED_HEADER_BYTES ||
      outputLength > outputCapacity
    ) {
      throw new Error('Cinejoy crush.wasm returned an invalid request')
    }
    const output = new Uint8Array(
      crush.memory.buffer,
      outputPointer,
      outputLength
    )
    return {
      responseKey: output.slice(0, RESPONSE_KEY_BYTES),
      keyId: output[RESPONSE_KEY_BYTES],
      ephemeralPublic: output.slice(
        RESPONSE_KEY_BYTES + 1,
        RESPONSE_KEY_BYTES + 1 + EPHEMERAL_PUBLIC_BYTES
      ),
      body: output.slice(SEALED_HEADER_BYTES),
    }
  } finally {
    crush.dealloc?.(requestPointer, request.byteLength)
    crush.dealloc?.(randomPointer, random.byteLength)
    crush.dealloc?.(outputPointer, outputCapacity)
  }
}

function responseAdditionalData(
  keyId: number,
  ephemeralPublic: Uint8Array
): Uint8Array {
  const prefix = new TextEncoder().encode(GATEWAY_PREFIX)
  const additionalData = new Uint8Array(
    prefix.byteLength + 3 + ephemeralPublic.byteLength
  )
  additionalData.set(prefix)
  additionalData.set([0, 2, keyId], prefix.byteLength)
  additionalData.set(ephemeralPublic, prefix.byteLength + 3)
  return additionalData
}

async function openResponse(
  encrypted: Uint8Array,
  sealed: SealedRequest
): Promise<CinejoyGatewayResponse> {
  if (encrypted.byteLength <= RESPONSE_HEADER_BYTES) {
    throw new Error('Cinejoy gateway response was too short')
  }
  const key = await webcrypto.subtle.importKey(
    'raw',
    asArrayBuffer(sealed.responseKey),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  )
  const plaintext = await webcrypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: asArrayBuffer(encrypted.slice(0, RESPONSE_HEADER_BYTES)),
      additionalData: asArrayBuffer(
        responseAdditionalData(sealed.keyId, sealed.ephemeralPublic)
      ),
      tagLength: GCM_TAG_BITS,
    },
    key,
    asArrayBuffer(encrypted.slice(RESPONSE_HEADER_BYTES))
  )
  const result = JSON.parse(
    new TextDecoder().decode(plaintext)
  ) as GatewayEnvelope
  if (
    !result ||
    typeof result.status !== 'number' ||
    result.status < 200 ||
    result.status >= 300
  ) {
    throw new Error(
      result?.error?.message ||
        `Cinejoy gateway returned status ${result?.status ?? 'unknown'}`
    )
  }
  if (!result.data || !Array.isArray(result.data.stream)) {
    throw new Error('Cinejoy gateway response had an unexpected shape')
  }
  return result.data
}

async function requestGateway(
  server: string,
  operation: 'movie' | 'series',
  payload: URLSearchParams
): Promise<CinejoyGatewayResponse> {
  const sealed = await sealRequest(`/${server}/${operation}`, payload)
  const response = await fetch(`${API_BASE}/g`, {
    method: 'POST',
    headers: GATEWAY_HEADERS,
    body: asArrayBuffer(sealed.body),
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for Cinejoy gateway`)
  }
  return openResponse(new Uint8Array(await response.arrayBuffer()), sealed)
}

export async function fetchCinejoyServers(): Promise<CinejoyGatewayServer[]> {
  const response = await fetch(`${API_BASE}/servers`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok)
    throw new Error(`HTTP ${response.status} for Cinejoy servers`)
  const data = (await response.json()) as { servers?: CinejoyGatewayServer[] }
  return (data.servers || []).filter(server => server?.name)
}

export async function fetchCinejoyMovie(
  server: string,
  tmdbId: string,
  title?: string,
  year?: string,
  imdbId?: string
): Promise<CinejoyGatewayResponse> {
  const payload = new URLSearchParams({ tmdb: tmdbId })
  if (title) payload.set('title', title)
  if (year) payload.set('year', year)
  if (imdbId) payload.set('imdb', imdbId)
  return requestGateway(server, 'movie', payload)
}

export async function fetchCinejoyTv(
  server: string,
  tmdbId: string,
  season: number,
  episode: number,
  title?: string,
  year?: string,
  imdbId?: string
): Promise<CinejoyGatewayResponse> {
  const payload = new URLSearchParams({
    tmdb: tmdbId,
    season: String(season),
    episode: String(episode),
  })
  if (title) payload.set('title', title)
  if (year) payload.set('year', year)
  if (imdbId) payload.set('imdb', imdbId)
  return requestGateway(server, 'series', payload)
}
