import { AsyncLocalStorage } from 'node:async_hooks'

export interface ForwardProxyContext {
  fProxyEnabled: boolean
  proxyUrl?: string
}

export const DEFAULT_FORWARD_PROXY_URL =
  'https://flixquest.beamlak.dev/proxy.php?url='

export const forwardProxyStorage = new AsyncLocalStorage<ForwardProxyContext>()

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

/**
 * Patches globalThis.fetch so all outbound provider fetch requests are
 * automatically routed through the forward proxy when fProxy is active.
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

      // Do not proxy requests that are already pointing to the proxy endpoint
      const currentProxy =
        store?.proxyUrl ||
        process.env.FORWARD_PROXY_URL?.trim() ||
        DEFAULT_FORWARD_PROXY_URL

      const proxyDomain = new URL(currentProxy.split('?')[0]).hostname
      if (targetUrlStr.includes(proxyDomain)) {
        return originalFetch(input, init)
      }

      const proxiedUrl = getForwardProxyUrl(targetUrlStr, store)

      if (proxiedUrl !== targetUrlStr) {
        console.log(
          `🔀 [ForwardProxy] Routing request via proxy: ${targetUrlStr} -> ${proxiedUrl}`
        )
        if (input instanceof Request) {
          return originalFetch(new Request(proxiedUrl, input), init)
        }
        return originalFetch(proxiedUrl, init)
      }
    }

    return originalFetch(input, init)
  }
}
