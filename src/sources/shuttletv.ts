/* eslint-disable no-unused-vars */
import vm from 'node:vm'
import { Buffer } from 'node:buffer'
import { Window } from 'happy-dom'
import type { ProviderLink, Subtitle } from '../types/index.js'

const CINESRC_BASE_URL = 'https://cinesrc.st'
const LISBON_SERVER_ID = 'lisbon'
const ACTION_ID = '7e401aae5708c04984ff004de286425e0af9166da6'
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
const scriptCache = new Map<string, string>()
export type ShuttleTvMediaType = 'movie' | 'tv'

interface DecryptedStream {
  url?: Array<{ url?: string; hash?: string }>
  captions?: Array<{
    url?: string
    file?: string
    label?: string
    language?: string
  }>
  name?: string
}
type RuntimeWindow = Window & Record<string, any>

function idOf(value: string): string {
  const id = value.trim()
  if (!/^\d+$/.test(id)) throw new Error('Invalid TMDB ID')
  return id
}
function validate(
  mediaType: ShuttleTvMediaType,
  season?: number,
  episode?: number
): void {
  if (
    mediaType === 'tv' &&
    (!Number.isInteger(season) ||
      !Number.isInteger(episode) ||
      season! < 1 ||
      episode! < 1)
  )
    throw new Error('TV streams require positive integer season and episode')
}

export function buildShuttleTvEmbedUrl(
  mediaType: ShuttleTvMediaType,
  tmdbId: string,
  season?: number,
  episode?: number
): string {
  const url = new URL(`/embed/${mediaType}/${idOf(tmdbId)}`, CINESRC_BASE_URL)
  validate(mediaType, season, episode)
  url.searchParams.set('prioritize', 'true')
  url.searchParams.set('lastserver', LISBON_SERVER_ID)
  if (mediaType === 'tv') {
    url.searchParams.set('s', String(season))
    url.searchParams.set('e', String(episode))
  }
  return url.href
}
class NodeWorker {
  private listeners = new Set<(event: { data: unknown }) => void>()
  private errorListeners = new Set<(event: { message?: string }) => void>()
  private onmessage?: (event: { data: unknown }) => void
  private onerror?: (event: { message?: string }) => void
  private context: Record<string, any>
  private ready: Promise<void>
  constructor(url: string) {
    const workerUrl = new URL(url, CINESRC_BASE_URL).href
    this.context = {
      self: null,
      crypto: globalThis.crypto,
      TextEncoder,
      TextDecoder,
      Uint8Array,
      Uint8ClampedArray,
      ArrayBuffer,
      Math,
      JSON,
      Date,
      Promise,
      setTimeout,
      clearTimeout,
      atob: (v: string) => Buffer.from(v, 'base64').toString('binary'),
      btoa: (v: string) => Buffer.from(v, 'binary').toString('base64'),
      postMessage: (value: unknown) =>
        queueMicrotask(() => {
          const event = { data: value }
          for (const fn of this.listeners) fn(event)
          this.onmessage?.(event)
        }),
    }
    this.context.self = this.context
    this.ready = fetch(workerUrl, { headers: { 'User-Agent': USER_AGENT } })
      .then(r => {
        if (!r.ok) throw new Error(`Cinesrc worker HTTP ${r.status}`)
        return r.text()
      })
      .then(code => {
        vm.createContext(this.context)
        vm.runInContext(code, this.context, { timeout: 20_000 })
      })
    // A worker script that fails to load or execute must never surface as an
    // unhandled promise rejection: Node >=15 crashes the process on those.
    // Instead, deliver the failure to the emulated runtime as an error event
    // so the challenge flow can give up and the request fails as a 500.
    void this.ready.catch(error => {
      const event = {
        message: error instanceof Error ? error.message : String(error),
      }
      queueMicrotask(() => {
        for (const fn of this.errorListeners) fn(event)
        this.onerror?.(event)
      })
    })
  }
  postMessage(value: unknown): void {
    void this.ready
      .then(() => this.context.onmessage?.({ data: value }))
      .catch(() => {
        // Worker never became ready; the error event above already fired.
      })
  }
  addEventListener(type: string, fn: (event: { data: unknown }) => void): void {
    if (type === 'message') this.listeners.add(fn)
    if (type === 'error') this.errorListeners.add(fn as never)
  }
  removeEventListener(
    type: string,
    fn: (event: { data: unknown }) => void
  ): void {
    if (type === 'message') this.listeners.delete(fn)
    if (type === 'error') this.errorListeners.delete(fn as never)
  }
  terminate(): void {}
}

async function script(path: string): Promise<string> {
  const cached = scriptCache.get(path)
  if (cached) return cached
  const r = await fetch(`${CINESRC_BASE_URL}${path}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(45_000),
  })
  if (!r.ok) throw new Error(`Cinesrc script HTTP ${r.status}`)
  const value = await r.text()
  scriptCache.set(path, value)
  return value
}

function runtimeWindow(referer: string): RuntimeWindow {
  const cookies = new Map<string, string>()
  const cookieHeader = () =>
    [...cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  const w = new Window({
    url: referer,
    width: 1920,
    height: 1080,
  }) as RuntimeWindow
  Object.defineProperty(w, 'Blob', {
    value: globalThis.Blob,
    configurable: true,
  })
  Object.assign(w, {
    self: w,
    globalThis: w,
    global: w,
    crypto: globalThis.crypto,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    Headers,
    Request,
    Response,
    AbortController,
    AbortSignal,
    Worker: undefined,
    fetch: async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(
        typeof input === 'string' || input instanceof URL
          ? String(input)
          : input.url,
        CINESRC_BASE_URL
      )
      const headers = new Headers(
        input instanceof Request ? input.headers : init.headers
      )
      headers.set('user-agent', USER_AGENT)
      headers.set('referer', referer)
      headers.set('origin', CINESRC_BASE_URL)
      if (cookieHeader()) headers.set('cookie', cookieHeader())
      const response = await fetch(url, {
        ...init,
        headers,
        signal: init.signal || AbortSignal.timeout(45_000),
      })
      for (const value of response.headers.getSetCookie?.() || []) {
        const pair = value.split(';', 1)[0]
        const i = pair.indexOf('=')
        if (i > 0) cookies.set(pair.slice(0, i), pair.slice(i + 1))
      }
      return response
    },
  })
  Object.defineProperties(w.navigator, {
    userAgent: { value: USER_AGENT, configurable: true },
    webdriver: { value: false, configurable: true },
    hardwareConcurrency: { value: 8, configurable: true },
  })
  const ctx = new Proxy(
    {
      canvas: { width: 300, height: 150 },
      fillStyle: '#000',
      strokeStyle: '#000',
      font: '10px sans-serif',
      textBaseline: 'alphabetic',
    },
    {
      get: (t, p) =>
        p in t
          ? (t as any)[p]
          : p === 'measureText'
            ? (x: unknown) => ({ width: String(x).length * 6 })
            : p === 'getImageData'
              ? () => ({ data: new Uint8ClampedArray(64) })
              : p === 'toDataURL'
                ? () => 'data:image/png;base64,'
                : () => {},
      set: (t, p, v) => (((t as any)[p] = v), true),
    }
  )
  const cp = Object.getPrototypeOf(w.document.createElement('canvas')) as any
  cp.getContext = () => ctx
  cp.toDataURL = () => 'data:image/png;base64,'
  vm.createContext(w)
  vm.runInContext(
    `(() => { const bind = Function.prototype.bind; Function.prototype.bind = function (...args) { if (typeof this !== 'function') { const ctor = this && this.constructor; if (typeof ctor === 'function') return bind.apply(ctor, args); return function () {} } return bind.apply(this, args) } })()`,
    w
  )
  return w
}

async function resolve(
  mediaType: ShuttleTvMediaType,
  tmdbId: string,
  season?: number,
  episode?: number
): Promise<DecryptedStream> {
  const id = idOf(tmdbId)
  validate(mediaType, season, episode)
  const referer = buildShuttleTvEmbedUrl(mediaType, id, season, episode)
  const w = runtimeWindow(referer)
  let cryptoApi: any
  w.addEventListener('_cs', (event: any) => {
    cryptoApi = w[String(event.detail)]
  })
  vm.runInContext(await script('/donut.js'), w, { timeout: 20_000 })
  vm.runInContext(await script('/130626-prod.js'), w, { timeout: 20_000 })
  if (!cryptoApi?.gc || !cryptoApi?.dr || !w.__ss2_challenge?.gc)
    throw new Error('Cinesrc challenge APIs unavailable')
  const query = Buffer.from(
    JSON.stringify([mediaType, id, season ?? null, episode ?? null])
  ).toString('base64url')
  const bootResponse = await w.fetch('/api/c/bootstrap', {
    method: 'POST',
    headers: { 'x-cs-q': query },
  })
  if (!bootResponse.ok)
    throw new Error(`Cinesrc bootstrap HTTP ${bootResponse.status}`)
  const boot = (await bootResponse.json()) as { r?: string; p?: string }
  if (!boot.r || !boot.p)
    throw new Error('Cinesrc bootstrap response incomplete')
  const originalFetch = w.fetch
  w.fetch = async (input: any, init: any = {}) => {
    const url = new URL(
      typeof input === 'string' || input instanceof URL
        ? String(input)
        : input.url,
      CINESRC_BASE_URL
    )
    const headers = new Headers(
      input instanceof Request ? input.headers : init.headers
    )
    if (
      url.pathname === '/api/c/issue' ||
      url.pathname === '/api/c/stage2/issue'
    ) {
      headers.set('x-cs-r', boot.r!)
      headers.set('x-cs-q', query)
      if (url.pathname === '/api/c/issue') headers.set('x-cs-p', boot.p!)
    }
    return originalFetch(input, { ...init, headers })
  }
  w.Worker = NodeWorker as any
  const [one, two] = await Promise.all([cryptoApi.gc(), w.__ss2_challenge.gc()])
  const action = await originalFetch(referer, {
    method: 'POST',
    headers: {
      'Next-Action': ACTION_ID,
      'Content-Type': 'text/plain;charset=UTF-8',
      Accept: 'text/x-component',
    },
    body: JSON.stringify([
      id,
      mediaType === 'tv' ? 'show' : 'movie',
      season ?? null,
      episode ?? null,
      `${one}::c2::${two}::c3::${boot.r}`,
      LISBON_SERVER_ID,
    ]),
  })
  if (!action.ok) throw new Error(`Cinesrc stream action HTTP ${action.status}`)
  const line = (await action.text()).split('\n').find(v => v.startsWith('1:'))
  if (!line) throw new Error('Cinesrc stream action returned no payload')
  return await cryptoApi.dr(JSON.parse(line.slice(2)))
}

export async function resolveShuttleTvStreams(
  mediaType: ShuttleTvMediaType,
  tmdbId: string,
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  const result = await resolve(mediaType, tmdbId, season, episode)
  const subtitles: Subtitle[] = (result.captions || []).flatMap(c => {
    const file = c.url || c.file
    return file && /^https?:\/\//i.test(file)
      ? [{ file, label: c.label || c.language || 'Unknown', kind: 'captions' }]
      : []
  })
  const links = (result.url || []).flatMap((entry, i) =>
    entry.url && /\.m3u8(?:$|[?#])/i.test(entry.url)
      ? [
          {
            server: `ShuttleTV | ${entry.hash || result.name || 'Lisbon'} | HLS${i ? ` ${i + 1}` : ''}`,
            url: entry.url,
            isM3U8: true,
            quality: 'Auto',
            subtitles,
            headers: {
              Referer: buildShuttleTvEmbedUrl(
                mediaType,
                tmdbId,
                season,
                episode
              ),
              Origin: CINESRC_BASE_URL,
              'User-Agent': USER_AGENT,
            },
            requiresProxy: true,
          } satisfies ProviderLink,
        ]
      : []
  )
  // A successful challenge that yields no playable streams (e.g. Cinesrc
  // replying `{"url":null,"error":"no_streams","provider":"lisbon"}`) means the
  // title is unavailable, not that resolution failed. Return an empty list so
  // the API answers 404 "No streams found" and callers can fall through to
  // other providers instead of surfacing a 500.
  if (!links.length) return []
  return links
}
