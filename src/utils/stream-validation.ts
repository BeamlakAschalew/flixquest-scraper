import type { Provider, ProviderLink } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from './config.js'
import { getForwardProxyUrl } from './forward-proxy.js'

const VALIDATION_TIMEOUT_MS = Math.max(15_000, DEFAULT_REQUEST_TIMEOUT_MS)
const VALIDATION_CONCURRENCY = 8
const VALIDATION_RETRIES = 2
const VALIDATION_RETRY_DELAY_MS = 1_000

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599)
}
const MEDIA_EXTENSION = /\.(?:m3u8|mpd|mp4|mkv|webm|avi|mov|ts)(?:$|[?#])/i
const MEDIA_CONTENT_TYPE =
  /^(?:video|audio)\/|mpegurl|dash\+xml|application\/(?:octet-stream|x-mpegurl)/i

export function normalizeStreamUrl(value: string): string {
  const url = new URL(value)
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error(`Unsupported stream protocol: ${url.protocol}`)
  }

  // URL does not percent-encode square brackets in paths. curl interprets them
  // as URL-globbing ranges, so encode them without touching IPv6 host syntax.
  url.pathname = url.pathname.replace(/\[/g, '%5B').replace(/\]/g, '%5D')
  return url.href
}

function linkIdentity(link: ProviderLink): string {
  return [
    link.url,
    link.hlsVariant || '',
    link.dashVideoHeight?.toString() || '',
  ].join('|')
}

function resolveValidatedUrl(requestUrl: string, responseUrl: string): string {
  const normalizedResponseUrl = normalizeStreamUrl(responseUrl || requestUrl)
  const forwardProxyUrl = getForwardProxyUrl(requestUrl)
  if (forwardProxyUrl === requestUrl) return normalizedResponseUrl

  try {
    if (
      new URL(normalizedResponseUrl).origin === new URL(forwardProxyUrl).origin
    ) {
      return requestUrl
    }
  } catch {
    // Keep the normalized response URL if either URL cannot be parsed.
  }

  return normalizedResponseUrl
}

async function validateLink(link: ProviderLink): Promise<ProviderLink | null> {
  let url: string
  try {
    url = normalizeStreamUrl(link.url)
  } catch {
    return null
  }

  const headers: Record<string, string> = {
    ...link.headers,
    Accept: '*/*',
  }
  if (!link.isM3U8 && !link.isDASH) headers.Range = 'bytes=0-0'
  try {
    if (!new URL(url).pathname.toLowerCase().includes('/playlist/')) {
      headers['x-skip-forward-proxy'] = 'true'
    }
  } catch {
    return null
  }

  let lastError: unknown
  let lastStatus = 0
  let lastContentType = ''

  for (let attempt = 0; attempt <= VALIDATION_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve =>
        setTimeout(resolve, VALIDATION_RETRY_DELAY_MS * 2 ** (attempt - 1))
      )
    }

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(VALIDATION_TIMEOUT_MS),
      })

      const finalUrl = resolveValidatedUrl(url, response.url)
      const contentType = response.headers.get('content-type') || ''
      const disposition = response.headers.get('content-disposition') || ''
      const looksLikeHtml = /(?:text\/html|application\/xhtml\+xml)/i.test(
        contentType
      )
      const looksLikeMedia =
        link.isM3U8 ||
        link.isDASH ||
        MEDIA_CONTENT_TYPE.test(contentType) ||
        MEDIA_EXTENSION.test(finalUrl) ||
        /filename\s*=.*\.(?:mp4|mkv|webm|avi|mov|ts)/i.test(disposition)

      await response.body?.cancel()
      if (!response.ok) {
        lastStatus = response.status
        lastContentType = contentType
        if (isRetryableStatus(response.status)) continue
        return null
      }
      if (looksLikeHtml || !looksLikeMedia) {
        lastStatus = response.status
        lastContentType = contentType
        return null
      }

      return {
        ...link,
        url: finalUrl,
        isM3U8:
          link.isM3U8 ||
          /mpegurl/i.test(contentType) ||
          /\.m3u8(?:$|[?#])/i.test(finalUrl),
      }
    } catch (error) {
      lastError = error
    }
  }

  if (lastStatus > 0) {
    console.warn(
      `[StreamValidation] Rejected ${url} after ${VALIDATION_RETRIES + 1} attempt(s): HTTP ${lastStatus} (${lastContentType || 'no content-type'})`
    )
  } else if (lastError) {
    console.warn(
      `[StreamValidation] Rejected ${url} after ${VALIDATION_RETRIES + 1} attempt(s): ${lastError instanceof Error ? lastError.message : 'unknown error'}`
    )
  }
  return null
}

export async function validateStreamLinks(
  links: ProviderLink[]
): Promise<ProviderLink[]> {
  const unique = Array.from(
    new Map(links.map(link => [linkIdentity(link), link] as const)).values()
  )
  const valid: ProviderLink[] = []

  for (
    let offset = 0;
    offset < unique.length;
    offset += VALIDATION_CONCURRENCY
  ) {
    const batch = await Promise.all(
      unique
        .slice(offset, offset + VALIDATION_CONCURRENCY)
        .map(link => validateLink(link))
    )
    valid.push(...batch.filter((link): link is ProviderLink => link !== null))
  }

  return Array.from(
    new Map(valid.map(link => [linkIdentity(link), link])).values()
  )
}

export function withStreamValidation(provider: Provider): Provider {
  async function validated(links: ProviderLink[]): Promise<ProviderLink[]> {
    const result = await validateStreamLinks(links)
    if (links.length !== result.length) {
      console.log(
        `[${provider.name}] Stream validation kept ${result.length}/${links.length} candidate(s)`
      )
    }
    return result
  }

  return {
    ...provider,
    streamMovie: async tmdbId => validated(await provider.streamMovie(tmdbId)),
    streamTV: async (tmdbId, season, episode) =>
      validated(await provider.streamTV(tmdbId, season, episode)),
  }
}
