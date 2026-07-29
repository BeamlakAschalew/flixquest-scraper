import { AsyncLocalStorage } from 'node:async_hooks'
import {
  formatRequestError,
  redactUrl,
  responseBodySnippet,
  responseDiagnostics,
} from './request-diagnostics.js'

export interface ForwardProxyContext {
  fProxyEnabled: boolean
  proxyUrl?: string
}

export const DEFAULT_FORWARD_PROXY_URL =
  'https://flixquest.beamlak.dev/proxy.php?url='

export const forwardProxyStorage = new AsyncLocalStorage<ForwardProxyContext>()

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

let isPatched = false
let requestSequence = 0

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

      // Do not proxy requests that are already pointing to the proxy endpoint
      const currentProxy =
        store?.proxyUrl ||
        process.env.FORWARD_PROXY_URL?.trim() ||
        DEFAULT_FORWARD_PROXY_URL

      const proxyDomain = new URL(currentProxy.split('?')[0]).hostname
      if (targetUrlStr.includes(proxyDomain)) {
        return originalFetch(input, init)
      }

      // Bypass fProxy for direct media and explicitly flagged requests
      if (isStreamOrPlaylistUrl(targetUrlStr, init)) {
        return originalFetch(input, init)
      }

      const proxiedUrl = getForwardProxyUrl(targetUrlStr, store)

      if (proxiedUrl !== targetUrlStr) {
        const requestId = `${process.pid}-${++requestSequence}`
        const startedAt = Date.now()
        console.log(
          `🔀 [ForwardProxy:${requestId}] Routing ${init?.method || (input instanceof Request ? input.method : 'GET')} ${redactUrl(targetUrlStr)} via ${redactUrl(proxiedUrl)}`
        )

        try {
          const response =
            input instanceof Request
              ? await originalFetch(new Request(proxiedUrl, input), init)
              : await originalFetch(proxiedUrl, init)
          const elapsedMs = Date.now() - startedAt

          console.log(
            `🔀 [ForwardProxy:${requestId}] Response after ${elapsedMs}ms: ${responseDiagnostics(response)}`
          )
          if (!response.ok) {
            console.warn(
              `🔀 [ForwardProxy:${requestId}] Non-2xx body: ${await responseBodySnippet(response)}`
            )
          }
          return response
        } catch (error) {
          console.error(
            `🔀 [ForwardProxy:${requestId}] Fetch threw after ${Date.now() - startedAt}ms; target=${redactUrl(targetUrlStr)} proxyHost=${new URL(proxiedUrl).host} error=${formatRequestError(error)}`
          )
          throw error
        }
      }
    }

    return originalFetch(input, init)
  }
}
