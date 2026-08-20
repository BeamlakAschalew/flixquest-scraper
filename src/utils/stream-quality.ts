import type { ProviderLink } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from './config.js'

const QUALITY_RESOLUTION_TIMEOUT_MS = Math.min(
  10_000,
  DEFAULT_REQUEST_TIMEOUT_MS
)
const QUALITY_RESOLUTION_CONCURRENCY = 8
const MAX_MANIFEST_BYTES = 1024 * 1024
const GENERIC_QUALITY = /^(?:auto|adaptive|unknown)?$/i

function qualityFromHeight(height: number | undefined): string | undefined {
  return height && Number.isSafeInteger(height) && height > 0
    ? `${height}p`
    : undefined
}

function heightsFromValues(values: Iterable<string | undefined>): number[] {
  const heights = Array.from(values, value => Number(value)).filter(
    height => Number.isSafeInteger(height) && height > 0
  )
  return Array.from(new Set(heights))
}

function hlsAttribute(line: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = line.match(
    new RegExp(
      `(?:^|,)\\s*${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^,\\r\\n]*))`,
      'i'
    )
  )
  return (match?.[1] ?? match?.[2] ?? match?.[3])?.trim()
}

function heightFromResolution(value: string | undefined): string | undefined {
  return value?.match(/^\s*\d+\s*x\s*(\d+)\s*$/i)?.[1]
}

function qualityFromHls(manifest: string): string | undefined {
  const resolutionHeights = heightsFromValues(
    manifest
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => /^#EXT-X-(?:I-FRAME-)?STREAM-INF\s*:/i.test(line))
      .map(line => heightFromResolution(hlsAttribute(line, 'RESOLUTION')))
  )
  if (resolutionHeights.length > 0) {
    return qualityFromHeight(Math.max(...resolutionHeights))
  }

  const declaredHeights = heightsFromValues(
    Array.from(
      manifest.matchAll(
        /(?:^|[,/_.-])(?:quality[=_-]?)?(2160|1440|1080|720|576|540|480|360|240|144)p?(?=$|[,/_.?&-])/gim
      ),
      match => match[1]
    )
  )
  return declaredHeights.length > 0
    ? qualityFromHeight(Math.max(...declaredHeights))
    : undefined
}

interface HlsVariant {
  url: string
  quality: string
  audioGroup?: string
}

function hlsVariants(manifest: string, masterUrl: string): HlsVariant[] {
  const lines = manifest.split(/\r?\n/)
  const variants: HlsVariant[] = []

  for (let index = 0; index < lines.length; index++) {
    const streamInfo = lines[index].trim()
    if (!streamInfo.startsWith('#EXT-X-STREAM-INF:')) continue

    const uri = lines
      .slice(index + 1)
      .map(line => line.trim())
      .find(line => line && !line.startsWith('#'))
    if (!uri) continue

    try {
      variants.push({
        url: new URL(uri, masterUrl).href,
        quality: qualityFromHls(`${streamInfo}\n${uri}`) || 'unknown',
        audioGroup: hlsAttribute(streamInfo, 'AUDIO'),
      })
    } catch {
      // Ignore invalid variant URLs without discarding other renditions.
    }
  }

  return Array.from(
    new Map(
      variants.map(variant => [`${variant.url}|${variant.quality}`, variant])
    ).values()
  )
}

function qualityFromDash(manifest: string): string | undefined {
  const heights = heightsFromValues([
    ...Array.from(
      manifest.matchAll(/\bheight\s*=\s*["'](\d+)["']/gi),
      match => match[1]
    ),
    ...Array.from(
      manifest.matchAll(/\bmaxHeight\s*=\s*["'](\d+)["']/gi),
      match => match[1]
    ),
  ])
  return heights.length > 0
    ? qualityFromHeight(Math.max(...heights))
    : undefined
}

async function readLimitedText(response: Response): Promise<string | null> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_MANIFEST_BYTES) {
    await response.body?.cancel()
    return null
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let byteLength = 0
  let text = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > MAX_MANIFEST_BYTES) {
        await reader.cancel()
        return null
      }
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

async function resolveLinkQuality(link: ProviderLink): Promise<ProviderLink[]> {
  if (!GENERIC_QUALITY.test(String(link.quality ?? '').trim())) return [link]
  if (!link.isM3U8 && !link.isDASH) {
    return [{ ...link, quality: 'unknown' }]
  }

  try {
    const response = await fetch(link.url, {
      headers: {
        ...link.headers,
        Accept: link.isDASH
          ? 'application/dash+xml, application/xml;q=0.9, */*;q=0.1'
          : 'application/vnd.apple.mpegurl, application/x-mpegURL, */*;q=0.1',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(QUALITY_RESOLUTION_TIMEOUT_MS),
    })
    if (!response.ok) {
      await response.body?.cancel()
      return [{ ...link, quality: 'unknown' }]
    }

    const manifest = await readLimitedText(response)
    if (manifest === null) return [{ ...link, quality: 'unknown' }]

    if (link.isM3U8) {
      const variants = hlsVariants(manifest, response.url || link.url)
      if (variants.length > 0) {
        return variants.map(variant => ({
          ...link,
          url: variant.url,
          quality: variant.quality,
          hlsVariant: undefined,
          sizeManifestUrl: link.url,
          sizeHlsVariantUrl: variant.url,
          sizeHlsAudioGroup: variant.audioGroup,
        }))
      }
      return [{ ...link, quality: qualityFromHls(manifest) || 'unknown' }]
    }

    return [{ ...link, quality: qualityFromDash(manifest) || 'unknown' }]
  } catch {
    return [{ ...link, quality: 'unknown' }]
  }
}

export async function resolveStreamQualities(
  links: ProviderLink[]
): Promise<ProviderLink[]> {
  const resolved: ProviderLink[] = []

  for (
    let offset = 0;
    offset < links.length;
    offset += QUALITY_RESOLUTION_CONCURRENCY
  ) {
    resolved.push(
      ...(
        await Promise.all(
          links
            .slice(offset, offset + QUALITY_RESOLUTION_CONCURRENCY)
            .map(link => resolveLinkQuality(link))
        )
      ).flat()
    )
  }

  return resolved
}
