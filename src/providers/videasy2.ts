/* eslint-disable no-unused-vars */
import { createDecipheriv, createHash, webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Provider, ProviderLink, Subtitle } from '../types/index.js'
import { generateMovieMedia, generateShowMedia } from '../utils/tmdb.js'
import {
  formatRequestError,
  redactUrl,
  responseBodySnippet,
  responseDiagnostics,
} from '../utils/request-diagnostics.js'

const API_BASE = 'https://api.videasy.net'
const REQUEST_TIMEOUT_MS = 20_000
const HASH_TIMEOUT_MS = 3_000
const ORIGIN = 'https://www.vidking.net'
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  Referer: `${ORIGIN}/`,
  Origin: ORIGIN,
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  Pragma: 'no-cache',
}

const SERVERS = [
  { name: 'Oxygen', endpoint: 'mb-flix' },
  { name: 'Hydrogen', endpoint: 'cdn' },
  { name: 'Lithium', endpoint: 'downloader2' },
] as const

interface MediaDetails {
  title: string
  year: string
  imdbId: string
}

interface VideasySource {
  url?: string
  file?: string
  quality?: string
  label?: string
  title?: string
}

interface VideasySubtitle {
  url?: string
  file?: string
  language?: string
  label?: string
  lang?: string
}

interface VideasyPayload {
  sources?: VideasySource[]
  subtitles?: VideasySubtitle[]
  tracks?: VideasySubtitle[]
}

interface VideasyWasmExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory
  serve: () => number
  __new: (size: number, id: number) => number
  verify: (hashPointer: number) => number
  decrypt: (cipherPointer: number, tmdbId: number) => number
}

interface VideasyWasm {
  serve: () => string | null
  verify: (hash: string) => boolean
  decrypt: (ciphertext: string, tmdbId: string) => string | null
}

let wasmPromise: Promise<VideasyWasm> | undefined
let hashPromise: Promise<string> | undefined

function readAssemblyScriptString(
  memory: WebAssembly.Memory,
  pointer: number
): string | null {
  pointer >>>= 0
  if (!pointer) return null

  const length = new Uint32Array(memory.buffer)[(pointer - 4) >>> 2]
  const characters = new Uint16Array(memory.buffer, pointer, length >>> 1)
  let output = ''
  for (let offset = 0; offset < characters.length; offset += 1024) {
    output += String.fromCharCode(...characters.subarray(offset, offset + 1024))
  }
  return output
}

function writeAssemblyScriptString(
  exports: VideasyWasmExports,
  value: string
): number {
  const pointer = exports.__new(value.length << 1, 2) >>> 0
  const memory = new Uint16Array(exports.memory.buffer)
  for (let index = 0; index < value.length; index++) {
    memory[(pointer >>> 1) + index] = value.charCodeAt(index)
  }
  return pointer
}

async function loadWasm(): Promise<VideasyWasm> {
  if (wasmPromise) return wasmPromise

  wasmPromise = (async () => {
    const wasmUrl = new URL('./videasy2.wasm', import.meta.url)
    const bytes = await readFile(wasmUrl)
    const { instance } = await WebAssembly.instantiate(bytes, {
      env: {
        seed: () => Date.now() * Math.random(),
        abort: () => undefined,
      },
    })
    const exports = instance.exports as VideasyWasmExports

    return {
      serve: () => readAssemblyScriptString(exports.memory, exports.serve()),
      verify: hash =>
        exports.verify(writeAssemblyScriptString(exports, hash)) !== 0,
      decrypt: (ciphertext, tmdbId) =>
        readAssemblyScriptString(
          exports.memory,
          exports.decrypt(
            writeAssemblyScriptString(exports, ciphertext),
            Number.parseInt(tmdbId, 10)
          )
        ),
    }
  })()

  try {
    return await wasmPromise
  } catch (error) {
    wasmPromise = undefined
    throw error
  }
}

function patchProofOfWork(code: string): string {
  const primary = code.replace(/_0x24\(\),_0x36\(/g, '_0x36(')
  if (primary !== code) return primary

  const cutoff = Math.max(0, code.length - 2_000)
  const tail = code
    .slice(cutoff)
    .replace(/_0x[a-f0-9]+\(\),(_0x[a-f0-9]+\()/g, '$1')
  return code.slice(0, cutoff) + tail
}

async function getVerificationHash(wasm: VideasyWasm): Promise<string> {
  if (hashPromise) return hashPromise

  hashPromise = (async () => {
    const servedCode = wasm.serve()
    if (!servedCode) throw new Error('WASM serve() returned no code')

    const fakeWindow: {
      location: { hostname: string; href: string }
      hash?: unknown
    } = {
      location: {
        hostname: 'vidking.net',
        href: 'https://www.vidking.net/',
      },
    }
    const execute = new Function(
      'window',
      'crypto',
      'TextEncoder',
      patchProofOfWork(servedCode)
    )
    execute(fakeWindow, webcrypto, TextEncoder)

    const deadline = Date.now() + HASH_TIMEOUT_MS
    while (fakeWindow.hash === undefined && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    const hash = String(fakeWindow.hash)
    if (!hash || hash === 'undefined') {
      throw new Error('WASM serve() did not produce a verification hash')
    }
    return hash
  })()

  try {
    return await hashPromise
  } catch (error) {
    hashPromise = undefined
    throw error
  }
}

function evpBytesToKey(
  salt: Buffer,
  keyLength = 32,
  ivLength = 16
): { key: Buffer; iv: Buffer } {
  let block = Buffer.alloc(0)
  let derived = Buffer.alloc(0)

  while (derived.length < keyLength + ivLength) {
    block = createHash('md5').update(block).update(salt).digest()
    derived = Buffer.concat([derived, block])
  }

  return {
    key: derived.subarray(0, keyLength),
    iv: derived.subarray(keyLength, keyLength + ivLength),
  }
}

function decryptOpenSslPayload(base64Data: string): string {
  const encrypted = Buffer.from(base64Data, 'base64')
  if (
    encrypted.length < 16 ||
    encrypted.subarray(0, 8).toString('utf8') !== 'Salted__'
  ) {
    throw new Error('Unexpected WASM output format')
  }

  const { key, iv } = evpBytesToKey(encrypted.subarray(8, 16))
  const decipher = createDecipheriv('aes-256-cbc', key, iv)
  return Buffer.concat([
    decipher.update(encrypted.subarray(16)),
    decipher.final(),
  ]).toString('utf8')
}

async function decryptPayload(
  ciphertext: string,
  tmdbId: string
): Promise<VideasyPayload> {
  const wasm = await loadWasm()
  const hash = await getVerificationHash(wasm)
  if (!wasm.verify(hash)) throw new Error('WASM verification failed')

  const intermediate = wasm.decrypt(ciphertext, tmdbId)
  if (!intermediate) throw new Error('WASM decrypt() returned no data')
  return JSON.parse(decryptOpenSslPayload(intermediate)) as VideasyPayload
}

async function getMediaDetails(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<MediaDetails> {
  if (mediaType === 'movie') {
    const media = await generateMovieMedia(tmdbId)
    return {
      title: media.title,
      year: String(media.releaseYear),
      imdbId: media.imdbId || '',
    }
  }

  const media = await generateShowMedia(tmdbId, season || 1, episode || 1)
  return {
    title: media.title,
    year: String(media.releaseYear),
    imdbId: '',
  }
}

function normalizeQuality(value?: string): string {
  const quality = String(value || 'Auto').trim()
  if (/2160|4k/i.test(quality)) return '2160p'
  if (/1080/i.test(quality)) return '1080p'
  if (/720/i.test(quality)) return '720p'
  if (/480/i.test(quality)) return '480p'
  if (/360/i.test(quality)) return '360p'
  return quality || 'Auto'
}

function formatLinks(
  payload: VideasyPayload,
  serverName: string
): ProviderLink[] {
  const subtitles: Subtitle[] = [
    ...(payload.subtitles || []),
    ...(payload.tracks || []),
  ].flatMap(subtitle => {
    const file = subtitle.file || subtitle.url
    if (!file || !/^https?:\/\//i.test(file)) return []
    return [
      {
        file,
        label:
          subtitle.language || subtitle.label || subtitle.lang || 'Unknown',
        kind: 'captions',
      },
    ]
  })

  return (payload.sources || []).flatMap((source, index) => {
    const url = source.url || source.file
    if (!url || !/^https?:\/\//i.test(url)) return []
    return [
      {
        server: `VidEasy2 | ${serverName} | ${index + 1}`,
        url,
        isM3U8: /\.m3u8(?:$|[?#])/i.test(url),
        quality: normalizeQuality(
          source.quality || source.label || source.title
        ),
        subtitles,
        headers: HEADERS,
      },
    ]
  })
}

async function fetchServer(
  server: (typeof SERVERS)[number],
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  details: MediaDetails,
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  const url = new URL(`${API_BASE}/${server.endpoint}/sources-with-title`)
  url.searchParams.set('title', details.title)
  url.searchParams.set('mediaType', mediaType)
  url.searchParams.set('year', details.year)
  url.searchParams.set('episodeId', String(episode || 1))
  url.searchParams.set('seasonId', String(season || 1))
  url.searchParams.set('tmdbId', tmdbId)
  url.searchParams.set('imdbId', details.imdbId)
  url.searchParams.set('_t', String(Date.now()))

  const startedAt = Date.now()
  console.log(`[VidEasy2:${server.name}] Requesting ${redactUrl(url.href)}`)
  const response = await fetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  console.log(
    `[VidEasy2:${server.name}] Completed in ${Date.now() - startedAt}ms: ${responseDiagnostics(response)}`
  )
  if (!response.ok) {
    console.warn(
      `[VidEasy2:${server.name}] Non-2xx body: ${await responseBodySnippet(response)}`
    )
    throw new Error(`HTTP ${response.status} (${response.statusText})`)
  }

  const ciphertext = (await response.text()).trim()
  if (!ciphertext) throw new Error('Empty encrypted response')
  return formatLinks(await decryptPayload(ciphertext, tmdbId), server.name)
}

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  try {
    if (!/^\d+$/.test(tmdbId)) throw new Error('TMDB ID must be numeric')
    const details = await getMediaDetails(tmdbId, mediaType, season, episode)

    for (const server of SERVERS) {
      try {
        const links = await fetchServer(
          server,
          tmdbId,
          mediaType,
          details,
          season,
          episode
        )
        if (links.length) return links
        console.warn(`[VidEasy2] ${server.name} returned no streams`)
      } catch (error) {
        console.warn(
          `[VidEasy2] ${server.name} failed: ${formatRequestError(error)}`
        )
      }
    }
  } catch (error) {
    console.error(`[VidEasy2] Provider failed: ${formatRequestError(error)}`)
  }
  return []
}

export const vidEasy2Provider: Provider = {
  name: 'VidEasy 2',
  id: 'videasy2',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
