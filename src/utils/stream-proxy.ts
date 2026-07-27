import { createHmac, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Request, Response as ExpressResponse } from 'express'
import type { ProviderLink } from '../types/index.js'
import {
  forwardProxyStorage,
  mustUseForwardProxyUrl,
  type ForwardProxyContext,
} from './forward-proxy.js'

const TOKEN_TTL_MS = 6 * 60 * 60 * 1000
const MAX_REDIRECTS = 8
const REQUEST_TIMEOUT_MS = 30_000

interface ProxyPayload {
  url: string
  headers: Record<string, string>
  expires: number
  isM3U8?: boolean
  isDASH?: boolean
  hlsVariant?: string
  hlsAudioLanguage?: string
  forwardProxy?: ForwardProxyContext
}

function getSigningSecret(): string {
  const secret =
    process.env.STREAM_PROXY_SECRET?.trim() || process.env.TMDB_API_KEY?.trim()
  if (!secret) {
    throw new Error('STREAM_PROXY_SECRET is not configured')
  }
  return secret
}

function sign(value: string): string {
  return createHmac('sha256', getSigningSecret())
    .update(value)
    .digest('base64url')
}

function createToken(link: ProviderLink): string {
  const forwardProxy = forwardProxyStorage.getStore()
  const payload = Buffer.from(
    JSON.stringify({
      url: link.url,
      headers: link.headers || {},
      expires: Date.now() + TOKEN_TTL_MS,
      isM3U8: link.isM3U8,
      isDASH: link.isDASH,
      hlsVariant: link.hlsVariant,
      hlsAudioLanguage: link.hlsAudioLanguage,
      forwardProxy: forwardProxy?.fProxyEnabled ? forwardProxy : undefined,
    } satisfies ProxyPayload)
  ).toString('base64url')
  return `${payload}.${sign(payload)}`
}

function decodeToken(token: string): ProxyPayload {
  const [encoded, signature, ...extra] = token.split('.')
  if (!encoded || !signature || extra.length > 0) {
    throw new Error('Malformed proxy token')
  }

  const expected = Buffer.from(sign(encoded))
  const received = Buffer.from(signature)
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    throw new Error('Invalid proxy token')
  }

  const payload = JSON.parse(
    Buffer.from(encoded, 'base64url').toString('utf8')
  ) as ProxyPayload
  if (
    !payload ||
    typeof payload.url !== 'string' ||
    typeof payload.expires !== 'number' ||
    payload.expires < Date.now() ||
    !payload.headers ||
    typeof payload.headers !== 'object' ||
    (payload.isM3U8 !== undefined && typeof payload.isM3U8 !== 'boolean') ||
    (payload.isDASH !== undefined && typeof payload.isDASH !== 'boolean') ||
    (payload.hlsVariant !== undefined &&
      typeof payload.hlsVariant !== 'string') ||
    (payload.hlsAudioLanguage !== undefined &&
      typeof payload.hlsAudioLanguage !== 'string') ||
    (payload.forwardProxy !== undefined &&
      (payload.forwardProxy.fProxyEnabled !== true ||
        (payload.forwardProxy.proxyUrl !== undefined &&
          typeof payload.forwardProxy.proxyUrl !== 'string')))
  ) {
    throw new Error('Expired or invalid proxy token')
  }
  return payload
}

function isPrivateAddress(address: string): boolean {
  if (address === '::1' || address === '::') return true
  if (address.startsWith('fc') || address.startsWith('fd')) return true
  if (address.startsWith('fe80:')) return true
  if (address.startsWith('::ffff:')) {
    return isPrivateAddress(address.slice('::ffff:'.length))
  }

  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) {
    return false
  }
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] === 0
  )
}

async function assertSafeDestination(value: string): Promise<URL> {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Unsupported destination protocol')
  }
  if (url.username || url.password) {
    throw new Error('Destination credentials are not allowed')
  }

  if (isIP(url.hostname)) {
    if (isPrivateAddress(url.hostname)) {
      throw new Error('Private destinations are not allowed')
    }
  } else {
    const addresses = await lookup(url.hostname, { all: true })
    if (
      addresses.length === 0 ||
      addresses.some(result => isPrivateAddress(result.address))
    ) {
      throw new Error('Private destinations are not allowed')
    }
  }
  return url
}

function outboundHeaders(
  payloadHeaders: Record<string, string>,
  req: Request,
  includeRange: boolean
): Record<string, string> {
  const headers = { ...payloadHeaders }
  for (const key of [
    'host',
    'connection',
    'content-length',
    'transfer-encoding',
    'accept-encoding',
    'range',
  ]) {
    delete headers[key]
    delete headers[
      Object.keys(headers).find(name => name.toLowerCase() === key) || ''
    ]
  }

  if (includeRange) {
    const range = req.get('range')
    if (range) headers.Range = range
    const ifRange = req.get('if-range')
    if (ifRange) headers['If-Range'] = ifRange
  }
  return headers
}

async function fetchWithSafeRedirects(
  initialUrl: string,
  method: 'GET' | 'HEAD',
  headers: Record<string, string>
): Promise<Response> {
  let url = await assertSafeDestination(initialUrl)
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    let response: Response
    try {
      const requestHeaders = { ...headers }
      if (!mustUseForwardProxyUrl(url.href)) {
        requestHeaders['x-skip-forward-proxy'] = 'true'
      }
      response = await fetch(url, {
        method,
        headers: requestHeaders,
        redirect: 'manual',
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) return response

    const location = response.headers.get('location')
    await response.body?.cancel()
    if (!location || redirects === MAX_REDIRECTS) {
      throw new Error('Invalid or excessive upstream redirects')
    }
    url = await assertSafeDestination(new URL(location, url).href)
  }
  throw new Error('Too many upstream redirects')
}

function proxyUrl(baseUrl: string, link: ProviderLink): string {
  const url = new URL('/proxy', baseUrl)
  url.searchParams.set('token', createToken(link))
  return url.href
}

function headersForDestination(
  headers: Record<string, string> | undefined,
  sourceUrl: string,
  destinationUrl: string
): Record<string, string> | undefined {
  if (!headers) return undefined

  try {
    if (new URL(sourceUrl).origin === new URL(destinationUrl).origin) {
      return headers
    }
  } catch {
    return headers
  }

  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'cookie')
  )
}

export function proxyStreamLinks(
  links: ProviderLink[],
  baseUrl: string
): ProviderLink[] {
  return links.map(link => {
    const publicLink = { ...link }
    delete publicLink.hlsVariant
    delete publicLink.hlsAudioLanguage
    const proxySubtitleUrl = (value: string, label: string): string => {
      try {
        const url = new URL(value)
        const localProxy = new URL('/proxy', baseUrl)
        if (!['http:', 'https:'].includes(url.protocol)) return value
        if (url.origin === localProxy.origin && url.pathname === '/proxy') {
          return value
        }

        const isM3U8 =
          /\.m3u8(?:$|[?#])/i.test(url.href) ||
          url.pathname.toLowerCase().includes('/playlist/')
        return proxyUrl(baseUrl, {
          server: `Subtitle | ${label}`,
          url: url.href,
          isM3U8,
          quality: 'auto',
          subtitles: [],
          headers: headersForDestination(link.headers, link.url, url.href),
        })
      } catch {
        return value
      }
    }

    return {
      ...publicLink,
      url: proxyUrl(baseUrl, link),
      subtitles: link.subtitles.map(subtitle => ({
        ...subtitle,
        file: proxySubtitleUrl(subtitle.file, subtitle.label),
      })),
    }
  })
}

export function selectHlsVariant(
  text: string,
  upstreamUrl: string,
  selectedVariant: string
): string {
  const lines = text.split(/\r?\n/)
  const selectedUrl = new URL(selectedVariant, upstreamUrl).href
  const output: string[] = []
  let matched = false

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (!line.startsWith('#EXT-X-STREAM-INF:')) {
      output.push(line)
      continue
    }

    let uriIndex = index + 1
    while (
      uriIndex < lines.length &&
      (!lines[uriIndex].trim() || lines[uriIndex].startsWith('#'))
    ) {
      uriIndex++
    }

    if (uriIndex >= lines.length) {
      output.push(line)
      continue
    }

    const variantUrl = new URL(lines[uriIndex].trim(), upstreamUrl).href
    if (variantUrl === selectedUrl) {
      output.push(...lines.slice(index, uriIndex + 1))
      matched = true
    }
    index = uriIndex
  }

  if (!matched) {
    throw new Error('Requested HLS variant is no longer available')
  }

  return output.join('\n')
}

export function setPreferredHlsAudio(
  text: string,
  preferredAudioLanguage: string
): string {
  const lines = text.split(/\r?\n/)
  const preferred = preferredAudioLanguage.toLowerCase()
  const preferredAudioIndex = lines.findIndex(line => {
    if (!line.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')) return false

    const language = line.match(/(?:^|,)LANGUAGE="([^"]+)"/)?.[1]
    const name = line.match(/(?:^|,)NAME="([^"]+)"/)?.[1]
    return (
      language?.toLowerCase() === preferred ||
      language?.toLowerCase().split('-')[0] === preferred.split('-')[0] ||
      (preferred === 'eng' && name?.toLowerCase().includes('english'))
    )
  })

  if (preferredAudioIndex < 0) return text

  return lines
    .map((line, index) => {
      if (!line.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')) return line

      const isPreferred = index === preferredAudioIndex
      const withDefault = setHlsAttribute(
        line,
        'DEFAULT',
        isPreferred ? 'YES' : 'NO'
      )
      return setHlsAttribute(
        withDefault,
        'AUTOSELECT',
        isPreferred ? 'YES' : 'NO'
      )
    })
    .join('\n')
}

function setHlsAttribute(
  line: string,
  attribute: string,
  value: string
): string {
  const pattern = new RegExp(`(${attribute}=)(?:"[^"]*"|[^,]*)`)
  return pattern.test(line)
    ? line.replace(pattern, `$1${value}`)
    : `${line},${attribute}=${value}`
}

function rewritePlaylistUri(
  value: string,
  upstreamUrl: string,
  headers: Record<string, string>,
  baseUrl: string
): string {
  try {
    const url = new URL(value, upstreamUrl).href
    return proxyUrl(baseUrl, {
      server: 'HLS segment',
      url,
      isM3U8:
        /\.m3u8(?:$|[?#])/i.test(url) ||
        new URL(url).pathname.toLowerCase().includes('/playlist/'),
      quality: 'auto',
      subtitles: [],
      headers,
    })
  } catch {
    return value
  }
}

function rewritePlaylist(
  text: string,
  upstreamUrl: string,
  headers: Record<string, string>,
  baseUrl: string
): string {
  return text
    .split(/\r?\n/)
    .map(line => {
      if (line && !line.startsWith('#')) {
        return rewritePlaylistUri(line, upstreamUrl, headers, baseUrl)
      }
      return line.replace(
        /URI="([^"]+)"/g,
        (_match, uri: string) =>
          `URI="${rewritePlaylistUri(uri, upstreamUrl, headers, baseUrl)}"`
      )
    })
    .join('\n')
}

function dashSegmentProxyUrl(
  value: string,
  token: string,
  baseUrl: string
): string {
  if (
    !value ||
    /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value) ||
    /[<>"'&#?]/.test(value)
  ) {
    return value
  }

  const url = new URL('/proxy', baseUrl)
  url.searchParams.set('token', token)
  return `${url.href.replace(/&/g, '&amp;')}&amp;dashPath=${value}`
}

function rewriteDashManifest(
  text: string,
  token: string,
  baseUrl: string
): string {
  return text
    .replace(
      /\b(initialization|media|sourceURL)="([^"]+)"/g,
      (_match, attribute: string, value: string) =>
        `${attribute}="${dashSegmentProxyUrl(value, token, baseUrl)}"`
    )
    .replace(
      /<BaseURL>([^<]+)<\/BaseURL>/g,
      (_match, value: string) =>
        `<BaseURL>${dashSegmentProxyUrl(value.trim(), token, baseUrl)}</BaseURL>`
    )
}

const RESPONSE_HEADERS = [
  'accept-ranges',
  'cache-control',
  'content-disposition',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'expires',
  'last-modified',
]

export async function handleStreamProxy(
  req: Request,
  res: ExpressResponse
): Promise<void> {
  try {
    const token = typeof req.query.token === 'string' ? req.query.token : ''
    const payload = decodeToken(token)
    const dashPath =
      typeof req.query.dashPath === 'string' ? req.query.dashPath : undefined
    let upstreamUrl = payload.url
    if (dashPath !== undefined) {
      if (!payload.isDASH || !dashPath || /[?#]/.test(dashPath)) {
        throw new Error('Invalid DASH segment path')
      }

      const manifestUrl = new URL(payload.url)
      const baseUrl = new URL('.', manifestUrl)
      const segmentUrl = new URL(dashPath, baseUrl)
      if (
        segmentUrl.origin !== baseUrl.origin ||
        !segmentUrl.pathname.startsWith(baseUrl.pathname)
      ) {
        throw new Error('Invalid DASH segment destination')
      }
      upstreamUrl = segmentUrl.href
    }
    await forwardProxyStorage.run(
      payload.forwardProxy || { fProxyEnabled: false },
      async () => {
        const headers = outboundHeaders(
          payload.headers,
          req,
          !payload.isM3U8 && !payload.isDASH
        )
        const upstream = await fetchWithSafeRedirects(
          upstreamUrl,
          req.method === 'HEAD' ? 'HEAD' : 'GET',
          headers
        )

        res.status(upstream.status)
        for (const name of RESPONSE_HEADERS) {
          const value = upstream.headers.get(name)
          if (value) res.setHeader(name, value)
        }
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')

        if (req.method === 'HEAD' || !upstream.body) {
          await upstream.body?.cancel()
          res.end()
          return
        }

        const contentType = upstream.headers.get('content-type') || ''
        if (
          payload.isDASH &&
          dashPath === undefined &&
          (/dash\+xml/i.test(contentType) ||
            /\.mpd(?:$|[?#])/i.test(upstream.url))
        ) {
          const manifest = rewriteDashManifest(
            await upstream.text(),
            token,
            `${req.protocol}://${req.get('host')}`
          )
          res.status(200)
          res.removeHeader('content-length')
          res.removeHeader('content-range')
          res.removeHeader('accept-ranges')
          res.removeHeader('content-disposition')
          res.type('application/dash+xml').send(manifest)
          return
        }
        if (
          payload.isM3U8 ||
          /mpegurl/i.test(contentType) ||
          /\.m3u8(?:$|[?#])/i.test(upstream.url)
        ) {
          const upstreamPlaylist = await upstream.text()
          let selectedPlaylist = payload.hlsVariant
            ? selectHlsVariant(
                upstreamPlaylist,
                payload.url,
                payload.hlsVariant
              )
            : upstreamPlaylist
          if (payload.hlsAudioLanguage) {
            selectedPlaylist = setPreferredHlsAudio(
              selectedPlaylist,
              payload.hlsAudioLanguage
            )
          }
          const playlist = rewritePlaylist(
            selectedPlaylist,
            payload.url,
            payload.headers,
            `${req.protocol}://${req.get('host')}`
          )
          res.status(200)
          res.removeHeader('content-length')
          res.removeHeader('content-range')
          res.removeHeader('accept-ranges')
          res.removeHeader('content-disposition')
          res.type('application/vnd.apple.mpegurl').send(playlist)
          return
        }

        await pipeline(
          Readable.fromWeb(
            upstream.body as Parameters<typeof Readable.fromWeb>[0]
          ),
          res
        )
      }
    )
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error instanceof Error ? error : undefined)
      return
    }
    const message = error instanceof Error ? error.message : 'Proxy failed'
    const status = /token|destination|protocol|private/i.test(message)
      ? 400
      : 502
    res.status(status).json({ success: false, error: message })
  }
}
