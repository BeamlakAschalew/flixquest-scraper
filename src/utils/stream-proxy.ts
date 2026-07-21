import { createHmac, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Request, Response as ExpressResponse } from 'express'
import type { ProviderLink } from '../types/index.js'

const TOKEN_TTL_MS = 6 * 60 * 60 * 1000
const MAX_REDIRECTS = 8
const REQUEST_TIMEOUT_MS = 30_000

interface ProxyPayload {
  url: string
  headers: Record<string, string>
  expires: number
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
  const payload = Buffer.from(
    JSON.stringify({
      url: link.url,
      headers: link.headers || {},
      expires: Date.now() + TOKEN_TTL_MS,
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
    typeof payload.headers !== 'object'
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
  req: Request
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

  const range = req.get('range')
  if (range) headers.Range = range
  const ifRange = req.get('if-range')
  if (ifRange) headers['If-Range'] = ifRange
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
      response = await fetch(url, {
        method,
        headers,
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

export function proxyStreamLinks(
  links: ProviderLink[],
  baseUrl: string
): ProviderLink[] {
  return links.map(link => ({
    ...link,
    url: proxyUrl(baseUrl, link),
  }))
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
      isM3U8: /\.m3u8(?:$|[?#])/i.test(url),
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
    const headers = outboundHeaders(payload.headers, req)
    const upstream = await fetchWithSafeRedirects(
      payload.url,
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
      /mpegurl/i.test(contentType) ||
      /\.m3u8(?:$|[?#])/i.test(upstream.url)
    ) {
      const playlist = rewritePlaylist(
        await upstream.text(),
        upstream.url,
        payload.headers,
        `${req.protocol}://${req.get('host')}`
      )
      res.removeHeader('content-length')
      res.type('application/vnd.apple.mpegurl').send(playlist)
      return
    }

    await pipeline(
      Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]),
      res
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
