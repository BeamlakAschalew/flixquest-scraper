/* eslint-disable no-unused-vars */
import crypto from 'node:crypto'
import vm from 'node:vm'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'

export interface VidCoreServer {
  name: string
  description?: string
  image?: string
  data: string
  selected?: boolean
}

export interface VidCoreBundleConfig {
  sourcePrefix: string
  sourceAction: string
  csrfToken: string
}

export interface VidCoreResolution {
  servers: VidCoreServer[]
  config: VidCoreBundleConfig
}

interface VidCoreVM {
  sh: (environment: Record<string, unknown>) => unknown
  decrypt: (environment: Record<string, unknown>) => unknown
  encode: (value: Buffer) => string
}

const REQUEST_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
const VIDCORE_ORIGINS = new Set(['https://vidcore.net', 'https://vidcore.io'])
const SOURCE_ACTION = 'ut2KSjl10ZQ'
const compiledRuntimes = new Map<string, VidCoreVM>()

function noop(): void {}

function universalStub(): unknown {
  let universal: unknown
  const target = function (): void {}
  universal = new Proxy(target, {
    get: () => universal,
    apply: () => universal,
    construct: () => universal as object,
  })
  return universal
}

function compileRuntime(bundleUrl: string, bundle: string): VidCoreVM {
  const cached = compiledRuntimes.get(bundleUrl)
  if (cached) return cached

  const currentStart = bundle.indexOf('9987:(t,e,W)=>{')
  if (
    currentStart >= 0 &&
    bundle.includes('function sg(t,e)') &&
    bundle.includes('function sA(') &&
    bundle.includes('function iV(')
  ) {
    return compileCurrentRuntime(bundleUrl, bundle, currentStart)
  }

  const start = bundle.indexOf('var cT=o(')
  const end = bundle.indexOf('function s_(', start)
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('VidCore player VM was not found in its bundle')
  }

  let source = bundle.slice(start, end)
  const cryptoImport = /var cT=o\(\d+\),cA=o\(\d+\)\.Buffer;o\(\d+\);/
  const bufferImport = /var cQ=o\(\d+\),cG=o\(\d+\)\.Buffer;/
  if (!cryptoImport.test(source) || !bufferImport.test(source)) {
    throw new Error('VidCore player imports have changed')
  }
  source = source
    .replace(cryptoImport, 'var cT=__crypto,cA=Buffer;')
    .replace(bufferImport, 'var cQ={},cG=Buffer;')
  source +=
    ';globalThis.__vidcoreSh=sh;globalThis.__vidcoreDecrypt=sA;globalThis.__vidcoreEncode=cI;'

  const stub = universalStub()
  const blockedFetch = (): never => {
    throw new Error('VidCore VM attempted an unscoped global fetch')
  }
  const context: Record<string, unknown> = {
    __crypto: crypto,
    Buffer,
    console: {
      log: noop,
      info: noop,
      warn: noop,
      error: noop,
      debug: noop,
      table: noop,
      clear: noop,
    },
    cO: stub,
    cN: stub,
    D: stub,
    k: stub,
    f: stub,
    h: stub,
    v: stub,
    C: stub,
    y: stub,
    S: stub,
    z: stub,
    L: stub,
    g: stub,
    w: stub,
    P: stub,
    fetch: blockedFetch,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    AbortSignal,
    AbortController,
    atob,
    btoa,
    navigator: {},
    screen: {},
    window: {},
    document: {},
    localStorage: {},
    crypto: crypto.webcrypto,
  }
  context.globalThis = context
  context.self = context

  vm.createContext(context, {
    name: 'VidCore protocol VM',
    codeGeneration: { strings: false, wasm: false },
  })
  vm.runInContext(source, context, {
    timeout: 20_000,
    displayErrors: true,
  })

  const sh = context.__vidcoreSh
  const decrypt = context.__vidcoreDecrypt
  const encode = context.__vidcoreEncode
  if (
    typeof sh !== 'function' ||
    typeof decrypt !== 'function' ||
    typeof encode !== 'function'
  ) {
    throw new Error('VidCore player VM did not expose its protocol functions')
  }

  const runtime: VidCoreVM = {
    sh: sh as VidCoreVM['sh'],
    decrypt: decrypt as VidCoreVM['decrypt'],
    encode: encode as VidCoreVM['encode'],
  }
  compiledRuntimes.set(bundleUrl, runtime)
  return runtime
}

function compileCurrentRuntime(
  bundleUrl: string,
  bundle: string,
  moduleStart: number
): VidCoreVM {
  const bodyStart = bundle.indexOf('=>{', moduleStart) + 3
  const bodyEnd = bundle.lastIndexOf('}}]);')
  if (bodyStart < 3 || bodyEnd <= bodyStart) {
    throw new Error('VidCore current player module could not be extracted')
  }

  const body = bundle.slice(bodyStart, bodyEnd)
  const source = `
    (function(t,e,W){
      ${body}
      globalThis.__vidcoreSh = sg;
      globalThis.__vidcoreDecrypt = sA;
      globalThis.__vidcoreEncode = iV;
    })({}, {}, __moduleLoader);
  `
  const stub = universalStub()
  const imported = (id: number): unknown => {
    if (id === 5376) return { Buffer }
    if (id === 3018) return crypto
    return stub
  }
  const moduleLoader = Object.assign(imported, {
    d: (exports: Record<string, unknown>, definitions: Record<string, unknown>) => {
      for (const [key, definition] of Object.entries(definitions)) {
        Object.defineProperty(exports, key, {
          enumerable: true,
          get: definition as () => unknown,
        })
      }
    },
  })
  const context: Record<string, unknown> = {
    __moduleLoader: moduleLoader,
    Buffer,
    crypto,
    JSON,
    Math,
    Date,
    RegExp,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Array,
    Object: new Proxy(Object, {
      get(target, property, receiver) {
        if (property === 'assign') {
          return (...args: unknown[]) => {
            if (args.some(value => value == null)) {
              console.error(
                '[Coreflix VM] Object.assign null argument',
                args.map(value => (value == null ? value : typeof value))
              )
            }
            if (args[0] == null) args[0] = {}
            return Object.assign(...(args as [object, ...object[]]))
          }
        }
        return Reflect.get(target, property, receiver)
      },
    }),
    Number,
    String,
    Boolean,
    Symbol,
    Function,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    NaN,
    Infinity,
    undefined,
    Promise,
    Proxy,
    Reflect,
    Uint8Array,
    Int8Array,
    Uint16Array,
    Int16Array,
    Uint32Array,
    Int32Array,
    Float32Array,
    Float64Array,
    BigInt,
    console: {
      log: noop,
      info: noop,
      warn: noop,
      error: noop,
      debug: noop,
      table: noop,
      clear: noop,
    },
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    AbortSignal,
    AbortController,
    atob,
    btoa,
    navigator: {},
    screen: {},
    window: {},
    document: {},
    localStorage: {},
    fetch: (): never => {
      throw new Error('VidCore VM attempted an unscoped global fetch')
    },
  }
  context.globalThis = context
  context.self = context
  vm.createContext(context, {
    name: 'VidCore current protocol VM',
    codeGeneration: { strings: false, wasm: false },
  })
  vm.runInContext(source, context, {
    timeout: 20_000,
    displayErrors: true,
  })

  const sh = context.__vidcoreSh
  const decrypt = context.__vidcoreDecrypt
  const encode = context.__vidcoreEncode
  if (
    typeof sh !== 'function' ||
    typeof decrypt !== 'function' ||
    typeof encode !== 'function'
  ) {
    throw new Error('VidCore current player VM did not expose protocol functions')
  }
  const runtime: VidCoreVM = {
    sh: sh as VidCoreVM['sh'],
    decrypt: decrypt as VidCoreVM['decrypt'],
    encode: encode as VidCoreVM['encode'],
  }
  compiledRuntimes.set(bundleUrl, runtime)
  return runtime
}

function nativeFunction(
  name: string,
  implementation: (...args: unknown[]) => unknown
): (...args: unknown[]) => unknown {
  const native = new Proxy(Array.prototype.push, {
    apply: (_target, _thisArg, argumentsList) =>
      implementation(...argumentsList),
  })
  Object.defineProperty(native, 'name', { value: name })
  return native as unknown as (...args: unknown[]) => unknown
}

function createBrowserFacade(): {
  window: Record<string, unknown>
  document: Record<string, unknown>
  navigator: Record<string, unknown>
  screen: Record<string, unknown>
  localStorage: Record<string, unknown>
} {
  const navigator = {
    userAgent: USER_AGENT,
    webdriver: false,
    maxTouchPoints: 0,
    platform: 'MacIntel',
  }
  const screen = { width: 2560 }
  const localStorage = {
    getItem: () => null,
    setItem: noop,
    removeItem: noop,
    clear: noop,
    length: 0,
  }
  const window: Record<string, unknown> = {
    parent: { postMessage: noop },
    crypto: crypto.webcrypto,
    name: '',
    requestAnimationFrame: nativeFunction('requestAnimationFrame', () => 1),
    cancelAnimationFrame: nativeFunction('cancelAnimationFrame', noop),
    matchMedia: nativeFunction('matchMedia', () => ({
      matches: false,
      addListener: noop,
      removeListener: noop,
    })),
  }
  window.window = window
  window.self = window
  window.top = window

  const document = {
    createElement: nativeFunction('createElement', () => ({
      style: {},
      setAttribute: noop,
      appendChild: noop,
    })),
    body: { appendChild: noop },
    documentElement: {},
    domain: 'vidcore.io',
  }

  return { window, document, navigator, screen, localStorage }
}

export async function resolveVidCoreServers(
  bundleUrl: string,
  bundle: string,
  pageUrl: string,
  en: string
): Promise<VidCoreResolution> {
  const runtime = compileRuntime(bundleUrl, bundle)
  const facade = createBrowserFacade()
  let servers: VidCoreServer[] = []
  let sourcePrefix = ''
  let csrfToken = ''

  const scopedFetch: typeof fetch = async (input, init = {}) => {
    const inputUrl =
      typeof input === 'string' || input instanceof URL
        ? String(input)
        : input.url
    const url = new URL(inputUrl, pageUrl)
    if (!VIDCORE_ORIGINS.has(url.origin)) {
      throw new Error(`VidCore VM fetch blocked for ${url.origin}`)
    }

    const headers = new Headers(
      init.headers ?? (input instanceof Request ? input.headers : undefined)
    )
    headers.set('User-Agent', USER_AGENT)
    headers.set('Referer', pageUrl)
    headers.set('Origin', url.origin)

    const parts = url.pathname.split('/')
    if (parts[2] === 'nedpekmib' && parts[3] === 'f' && parts[4]) {
      sourcePrefix = `/${parts.slice(1, 5).join('/')}`
      csrfToken = headers.get('X-Csrf-Token') ?? csrfToken
    }
    return fetch(url, {
      ...init,
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  }

  const environment: Record<string, unknown> = {
    crypto,
    encode: runtime.encode,
    server: {},
    setServers: (
      value: VidCoreServer[] | ((current: VidCoreServer[]) => VidCoreServer[])
    ) => {
      console.error(
        '[Coreflix VM] setServers',
        typeof value,
        Array.isArray(value) ? value.length : ''
      )
      servers = typeof value === 'function' ? value(servers) : value
    },
    setState: noop,
    setFavServer: noop,
    ...facade,
    console: {
      log: noop,
      info: noop,
      warn: noop,
      error: noop,
      debug: noop,
      table: noop,
      clear: noop,
    },
    JSON,
    Math,
    Date,
    RegExp,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Array,
    Object,
    Number,
    String,
    Boolean,
    Symbol,
    Function,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    parseInt,
    parseFloat,
    en,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    NaN,
    Infinity,
    undefined,
    Promise,
    Proxy,
    Reflect,
    Uint8Array,
    Int8Array,
    Uint16Array,
    Int16Array,
    Uint32Array,
    Int32Array,
    Float32Array,
    Float64Array,
    BigInt,
    fetch: scopedFetch,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    AbortSignal,
    AbortController,
    Buffer,
    atob,
    btoa,
  }

  try {
    await runtime.sh(environment)
  } catch (error) {
    throw new Error(
      `VidCore server resolver failed: ${
        error instanceof Error ? error.stack || error.message : String(error)
      }`
    )
  }
  const valid = servers.filter(
    server =>
      server &&
      typeof server.name === 'string' &&
      typeof server.data === 'string' &&
      server.data.length > 0
  )
  if (valid.length === 0) throw new Error('VidCore returned no server tokens')
  if (!sourcePrefix || !csrfToken) {
    throw new Error('VidCore did not expose its source request metadata')
  }
  return {
    servers: valid,
    config: { sourcePrefix, sourceAction: SOURCE_ACTION, csrfToken },
  }
}

export async function decryptVidCorePayload<T>(
  bundleUrl: string,
  bundle: string,
  encryptedText: string
): Promise<T> {
  const runtime = compileRuntime(bundleUrl, bundle)
  const output: unknown[] = []
  const facade = createBrowserFacade()
  const blockedFetch = (): never => {
    throw new Error('VidCore decryptor attempted a network request')
  }
  const environment: Record<string, unknown> = {
    dr: output,
    rs: encryptedText,
    crypto,
    ...facade,
    console: {
      log: noop,
      info: noop,
      warn: noop,
      error: noop,
      debug: noop,
      table: noop,
      clear: noop,
    },
    JSON,
    Math,
    Date,
    RegExp,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Array,
    Object,
    Number,
    String,
    Boolean,
    Symbol,
    Function,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    NaN,
    Infinity,
    undefined,
    Promise,
    Proxy,
    Reflect,
    Uint8Array,
    Int8Array,
    Uint16Array,
    Int16Array,
    Uint32Array,
    Int32Array,
    Float32Array,
    Float64Array,
    BigInt,
    fetch: blockedFetch,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    AbortSignal,
    AbortController,
    Buffer,
    atob,
    btoa,
  }

  await runtime.decrypt(environment)
  if (!output[0] || typeof output[0] !== 'object') {
    throw new Error('VidCore source decryptor returned no payload')
  }
  return output[0] as T
}
