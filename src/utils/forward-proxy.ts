import { AsyncLocalStorage } from 'node:async_hooks'
import { lookup } from 'node:dns/promises'
import type { PooledProxy } from './connect-proxy.js'
import {
  fetchThroughConnectProxy,
  findPooledProxy,
  getConnectProxyPool,
  maxConnectProxyAttempts,
  nextPooledProxy,
  poolIncludesProxy,
  reportPooledProxyFailure,
  reportPooledProxySuccess,
} from './connect-proxy.js'
import {
  formatRequestError,
  redactUrl,
  responseBodySnippet,
  responseDiagnostics,
} from './request-diagnostics.js'

export interface ForwardProxyContext {
  fProxyEnabled: boolean
  proxyUrl?: string
  pinnedProxyUrl?: string
}

export const DEFAULT_FORWARD_PROXY_URL =
  'https://flixquest.beamlak.dev/proxy.php?url='

export const FALLBACK_FORWARD_PROXY_URL = 'https://onyx.et/proxy.php?url='

export const forwardProxyStorage = new AsyncLocalStorage<ForwardProxyContext>()

export function withForcedForwardProxy<T>(
  callback: () => Promise<T>
): Promise<T> {
  const context = forwardProxyStorage.getStore()
  return forwardProxyStorage.run(
    {
      fProxyEnabled: true,
      proxyUrl: context?.proxyUrl,
      pinnedProxyUrl: context?.pinnedProxyUrl,
    },
    callback
  )
}

/**
 * Vixsrc signs its manifests and CDN resources against the request context.
 * Keep the complete Vixsrc playback chain on the same fProxy egress.
 */
export function mustUseForwardProxyUrl(urlStr: string): boolean {
  try {
    const hostname = new URL(urlStr).hostname.toLowerCase()
    return (
      hostname === 'vixsrc.to' ||
      hostname.endsWith('.vixsrc.to') ||
      hostname === 'vix-content.net' ||
      hostname.endsWith('.vix-content.net')
    )
  } catch {
    return false
  }
}

function isTmdbApiUrl(urlStr: string): boolean {
  try {
    return new URL(urlStr).hostname.toLowerCase() === 'api.themoviedb.org'
  } catch {
    return false
  }
}

/**
 * Determines if a target URL is a direct media call that should bypass
 * forward proxying. Tokenized playlist endpoints remain on fProxy.
 */
export function isStreamOrPlaylistUrl(
  urlStr: string,
  init?: RequestInit
): boolean {
  if (mustUseForwardProxyUrl(urlStr)) return false

  if (init?.headers) {
    if (init.headers instanceof Headers) {
      if (init.headers.get('x-skip-forward-proxy') === 'true') return true
    } else if (Array.isArray(init.headers)) {
      if (
        init.headers.some(
          ([k, v]) => k.toLowerCase() === 'x-skip-forward-proxy' && v === 'true'
        )
      ) {
        return true
      }
    } else if (typeof init.headers === 'object') {
      const headersObj = init.headers as Record<string, string>
      if (
        headersObj['x-skip-forward-proxy'] === 'true' ||
        headersObj['X-Skip-Forward-Proxy'] === 'true'
      ) {
        return true
      }
    }
  }

  const lowerUrl = urlStr.toLowerCase()

  // Other tokenized playlist endpoints also remain on fProxy.
  if (lowerUrl.includes('/playlist/')) {
    return false
  }

  // Common media file extensions
  if (/\.(?:m3u8|mp4|mkv|webm|avi|mov|ts|mpd|key)(?:$|[?#])/i.test(urlStr)) {
    return true
  }

  // Provider-specific stream path patterns
  if (
    lowerUrl.includes('/hls/') ||
    lowerUrl.includes('/manifest/') ||
    lowerUrl.includes('/stream/') ||
    lowerUrl.includes('/chunks/') ||
    lowerUrl.includes('/segment/')
  ) {
    return true
  }

  return false
}

/**
 * Returns the proxied URL if forward proxying is enabled, or the original target URL.
 */
export function getForwardProxyUrl(
  targetUrl: string,
  context?: ForwardProxyContext
): string {
  const store = context || forwardProxyStorage.getStore()
  const isGlobalAlways = process.env.FORWARD_PROXY_ALWAYS === 'true'
  const isEnabled = isGlobalAlways || (store?.fProxyEnabled ?? false)

  if (!isEnabled) {
    return targetUrl
  }

  // Skip local/internal requests
  if (targetUrl.includes('localhost') || targetUrl.includes('127.0.0.1')) {
    return targetUrl
  }

  const baseProxyUrl =
    store?.proxyUrl ||
    process.env.FORWARD_PROXY_URL?.trim() ||
    DEFAULT_FORWARD_PROXY_URL

  return buildForwardProxyUrl(baseProxyUrl, targetUrl)
}

function buildForwardProxyUrl(baseProxyUrl: string, targetUrl: string): string {
  if (baseProxyUrl.includes('%s')) {
    return baseProxyUrl.replace('%s', encodeURIComponent(targetUrl))
  }

  const hasUrlParam = baseProxyUrl.includes('url=')
  const separator = hasUrlParam
    ? ''
    : baseProxyUrl.includes('?')
      ? '&url='
      : '?url='

  return `${baseProxyUrl}${separator}${encodeURIComponent(targetUrl)}`
}

interface ForwardProxyCandidate {
  baseUrl: string
  source: ForwardProxyFailure['proxySource']
}

function getForwardProxyCandidates(
  store: ForwardProxyContext | undefined
): ForwardProxyCandidate[] {
  if (store?.proxyUrl) {
    return [{ baseUrl: store.proxyUrl, source: 'request' }]
  }

  const primaryEnvironmentUrl = process.env.FORWARD_PROXY_URL?.trim()
  const fallbackEnvironmentUrl = process.env.FORWARD_PROXY_FALLBACK_URL?.trim()
  const candidates: ForwardProxyCandidate[] = [
    {
      baseUrl: primaryEnvironmentUrl || DEFAULT_FORWARD_PROXY_URL,
      source: primaryEnvironmentUrl ? 'environment' : 'default',
    },
    {
      baseUrl: fallbackEnvironmentUrl || FALLBACK_FORWARD_PROXY_URL,
      source: fallbackEnvironmentUrl ? 'environment' : 'default',
    },
  ]

  const seen = new Set<string>()
  return candidates.filter(candidate => {
    let normalizedUrl = candidate.baseUrl.trim()
    try {
      normalizedUrl = new URL(
        buildForwardProxyUrl(
          candidate.baseUrl,
          'https://forward-proxy-dedupe.invalid/'
        )
      ).href
    } catch {
      // Keep the raw configured URL; fetch will report a useful final error.
    }
    if (seen.has(normalizedUrl)) return false
    seen.add(normalizedUrl)
    return true
  })
}

export function isForwardProxyUrl(
  targetUrl: string,
  context?: ForwardProxyContext
): boolean {
  const store = context || forwardProxyStorage.getStore()
  try {
    const targetHostname = new URL(targetUrl).hostname.toLowerCase()
    const configuredUrls = [
      store?.proxyUrl,
      process.env.FORWARD_PROXY_URL?.trim(),
      process.env.FORWARD_PROXY_FALLBACK_URL?.trim(),
      DEFAULT_FORWARD_PROXY_URL,
      FALLBACK_FORWARD_PROXY_URL,
    ]

    return configuredUrls.some(proxyUrl => {
      if (!proxyUrl) return false
      try {
        return new URL(proxyUrl).hostname.toLowerCase() === targetHostname
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}

function shouldRetryForwardProxyResponse(response: Response): boolean {
  return (
    response.status === 403 ||
    response.status === 408 ||
    response.status === 429 ||
    response.status >= 500
  )
}

let isPatched = false
let requestSequence = 0

interface ForwardProxyFailure extends Error {
  code: 'FORWARD_PROXY_FETCH_FAILED'
  requestId: string
  elapsedMs: number
  targetUrl: string
  proxyUrl: string
  proxySource: 'request' | 'environment' | 'default'
  hostname: string
  port: number
  proxyAddresses?: Array<{ address: string; family: number }>
  dnsError?: unknown
}

async function lookupProxyAddresses(
  hostname: string
): Promise<Array<{ address: string; family: number }>> {
  let timeout: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(new Error('Proxy DNS diagnostic timed out after 2000ms')),
          2_000
        )
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function createForwardProxyFailure(
  error: unknown,
  requestId: string,
  startedAt: number,
  targetUrl: string,
  proxiedUrl: string,
  proxySource: ForwardProxyFailure['proxySource']
): Promise<ForwardProxyFailure> {
  const parsedProxyUrl = new URL(proxiedUrl)
  const elapsedMs = Date.now() - startedAt
  const proxyPort = Number(
    parsedProxyUrl.port || (parsedProxyUrl.protocol === 'http:' ? 80 : 443)
  )
  const failure = new Error(
    `Forward proxy request failed after ${elapsedMs}ms: ${parsedProxyUrl.hostname}:${proxyPort}`,
    { cause: error }
  ) as ForwardProxyFailure

  failure.name = 'ForwardProxyError'
  failure.code = 'FORWARD_PROXY_FETCH_FAILED'
  failure.requestId = requestId
  failure.elapsedMs = elapsedMs
  failure.targetUrl = redactUrl(targetUrl)
  failure.proxyUrl = redactUrl(proxiedUrl)
  failure.proxySource = proxySource
  failure.hostname = parsedProxyUrl.hostname
  failure.port = proxyPort

  try {
    failure.proxyAddresses = await lookupProxyAddresses(parsedProxyUrl.hostname)
  } catch (dnsError) {
    failure.dnsError = dnsError
  }

  return failure
}

/**
 * Patches globalThis.fetch so outbound scraping & metadata requests are
 * automatically routed through the forward proxy when fProxy is active,
 * while direct media streams bypass fProxy.
 */
export function setupForwardProxyPatch() {
  if (isPatched) return
  isPatched = true

  const originalFetch = globalThis.fetch

  globalThis.fetch = async function (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const store = forwardProxyStorage.getStore()
    const isGlobalAlways = process.env.FORWARD_PROXY_ALWAYS === 'true'

    if (store?.fProxyEnabled || isGlobalAlways) {
      let targetUrlStr: string
      if (typeof input === 'string') {
        targetUrlStr = input
      } else if (input instanceof URL) {
        targetUrlStr = input.href
      } else if (input instanceof Request) {
        targetUrlStr = input.url
      } else {
        targetUrlStr = String(input)
      }

      // TMDB metadata requests should always use the server's direct egress.
      if (isTmdbApiUrl(targetUrlStr)) {
        return originalFetch(input, init)
      }

      // Do not recursively wrap requests to either configured proxy endpoint.
      if (isForwardProxyUrl(targetUrlStr, store)) {
        return originalFetch(input, init)
      }

      // Bypass fProxy for direct media and explicitly flagged requests
      if (isStreamOrPlaylistUrl(targetUrlStr, init)) {
        return originalFetch(input, init)
      }

      const requestId = `${process.pid}-${++requestSequence}`
      const startedAt = Date.now()
      const requestTemplate =
        input instanceof Request
          ? new Request(input, init)
          : new Request(targetUrlStr, init)

      const relayCandidates = getForwardProxyCandidates(store)
      const connectPool = getConnectProxyPool()
      const connectAttempts = connectPool?.size()
        ? maxConnectProxyAttempts()
        : 0
      const hasCandidates = connectAttempts > 0 || relayCandidates.length > 0

      if (hasCandidates) {
        let lastError: unknown
        let lastProxiedUrl = ''
        let lastSource: ForwardProxyCandidate['source'] = 'default'

        const pinnedUrl = store?.pinnedProxyUrl
        const pinnedProxy =
          pinnedUrl && poolIncludesProxy(pinnedUrl)
            ? findPooledProxy(pinnedUrl)
            : undefined

        let attempt = 0
        let proxy: PooledProxy | undefined
        if (pinnedProxy) {
          proxy = pinnedProxy
        } else {
          proxy = nextPooledProxy()
        }

        while (proxy && attempt < connectAttempts) {
          const currentProxy = proxy
          const attemptLabel = `connect:${attempt + 1}/${connectAttempts}${pinnedProxy ? ' (pinned)' : ''}`
          console.log(
            `🔀 [ForwardProxy:${requestId}] Routing attempt ${attemptLabel} ${requestTemplate.method} ${redactUrl(targetUrlStr)} via ${redactUrl(currentProxy.url)}`
          )

          try {
            const response = await fetchThroughConnectProxy(
              targetUrlStr,
              currentProxy,
              requestTemplate,
              undefined,
              requestTemplate.signal
            )
            const elapsedMs = Date.now() - startedAt

            console.log(
              `🔀 [ForwardProxy:${requestId}] Response after ${elapsedMs}ms: ${responseDiagnostics(response)}`
            )
            if (!response.ok) {
              console.warn(
                `🔀 [ForwardProxy:${requestId}] Non-2xx body: ${await responseBodySnippet(response)}`
              )
            }

            // Only rotate on proxy-fingerprint rejections (403) and rate
            // limiting. Target-side 5xx responses are returned as-is so a
            // healthy proxy is not penalized for the upstream's own failure.
            if (
              response.status === 403 ||
              response.status === 408 ||
              response.status === 429
            ) {
              reportPooledProxyFailure(currentProxy, `HTTP ${response.status}`)
              console.warn(
                `🔀 [ForwardProxy:${requestId}] Proxy returned ${response.status}; trying another proxy`
              )
              if (store) store.pinnedProxyUrl = undefined
              attempt += 1
              proxy = nextPooledProxy()
              continue
            }

            if (store) store.pinnedProxyUrl = currentProxy.url
            reportPooledProxySuccess(currentProxy)
            return response
          } catch (error) {
            reportPooledProxyFailure(currentProxy, formatRequestError(error))
            lastError = error
            lastProxiedUrl = currentProxy.url
            lastSource = 'request'
            console.warn(
              `🔀 [ForwardProxy:${requestId}] Proxy attempt ${attemptLabel} failed after ${Date.now() - startedAt}ms; trying another proxy: ${formatRequestError(error)}`
            )
            if (store) store.pinnedProxyUrl = undefined
            attempt += 1
            proxy = nextPooledProxy()
          }
        }

        for (const [index, candidate] of relayCandidates.entries()) {
          const proxiedUrl = buildForwardProxyUrl(
            candidate.baseUrl,
            targetUrlStr
          )
          const hasFallback = index < relayCandidates.length - 1
          const attempt = index + 1

          console.log(
            `🔀 [ForwardProxy:${requestId}] Routing attempt ${attempt}/${relayCandidates.length} ${requestTemplate.method} ${redactUrl(targetUrlStr)} via ${redactUrl(proxiedUrl)}`
          )

          try {
            const response = await originalFetch(
              new Request(proxiedUrl, requestTemplate.clone())
            )
            const elapsedMs = Date.now() - startedAt

            console.log(
              `🔀 [ForwardProxy:${requestId}] Response after ${elapsedMs}ms: ${responseDiagnostics(response)}`
            )
            if (!response.ok) {
              console.warn(
                `🔀 [ForwardProxy:${requestId}] Non-2xx body: ${await responseBodySnippet(response)}`
              )
            }

            if (hasFallback && shouldRetryForwardProxyResponse(response)) {
              console.warn(
                `🔀 [ForwardProxy:${requestId}] Proxy returned ${response.status}; retrying the same request through fallback`
              )
              continue
            }

            return response
          } catch (error) {
            if (hasFallback) {
              console.warn(
                `🔀 [ForwardProxy:${requestId}] Proxy attempt ${attempt} failed after ${Date.now() - startedAt}ms; retrying the same request through fallback: ${formatRequestError(error)}`
              )
              continue
            }

            lastError = error
            lastProxiedUrl = proxiedUrl
            lastSource = candidate.source
          }
        }

        if (lastError) {
          const failure = await createForwardProxyFailure(
            lastError,
            requestId,
            startedAt,
            targetUrlStr,
            lastProxiedUrl,
            lastSource
          )
          console.error(
            `🔀 [ForwardProxy:${requestId}] ${formatRequestError(failure)}`
          )
          throw failure
        }
      }
    }

    return originalFetch(input, init)
  }
}
