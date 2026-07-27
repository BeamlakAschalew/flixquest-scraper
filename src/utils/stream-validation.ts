import type { Provider, ProviderLink } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from './config.js'

const VALIDATION_TIMEOUT_MS = Math.max(15_000, DEFAULT_REQUEST_TIMEOUT_MS)
const VALIDATION_CONCURRENCY = 8
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

async function validateLink(link: ProviderLink): Promise<ProviderLink | null> {
  let url: string
  try {
    url = normalizeStreamUrl(link.url)
  } catch {
    return null
  }

  try {
    const headers: Record<string, string> = {
      ...link.headers,
      Accept: '*/*',
    }
    if (!link.isM3U8 && !link.isDASH) headers.Range = 'bytes=0-0'
    if (!new URL(url).pathname.toLowerCase().includes('/playlist/')) {
      headers['x-skip-forward-proxy'] = 'true'
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(VALIDATION_TIMEOUT_MS),
    })

    const finalUrl = normalizeStreamUrl(response.url || url)
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
    if (!response.ok || looksLikeHtml || !looksLikeMedia) return null

    return {
      ...link,
      url: finalUrl,
      isM3U8:
        link.isM3U8 ||
        /mpegurl/i.test(contentType) ||
        /\.m3u8(?:$|[?#])/i.test(finalUrl),
    }
  } catch {
    return null
  }
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
