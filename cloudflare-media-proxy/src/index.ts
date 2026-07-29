import { rewriteHlsPlaylist } from './hls.js'

interface Env {
  SESSIONS: DurableObjectNamespace
  SERVICE_TOKEN: string
  SIGNING_SECRET: string
  ALLOWED_HOSTS: string
  CORS_ORIGIN?: string
  PUBLIC_BASE_URL?: string
  SESSION_TTL_SECONDS?: string
  MAX_PLAYLIST_BYTES?: string
  MAX_CONTROL_BODY_BYTES?: string
  ALLOW_NON_STANDARD_PORTS?: string
  UPSTREAM_TIMEOUT_MS?: string
}

type LocationHint =
  | 'wnam'
  | 'enam'
  | 'sam'
  | 'weur'
  | 'eeur'
  | 'apac'
  | 'apac-ne'
  | 'apac-se'
  | 'oc'
  | 'afr'
  | 'me'

interface SessionMetadata {
  version: 1
  createdAt: number
  expiresAt: number
}

interface CookieRecord {
  name: string
  value: string
  domain: string
  path: string
  hostOnly: boolean
  secure: boolean
  expiresAt?: number
}

interface RequestScope {
  headers: Record<string, string>
  publicMediaBase: string
}

interface MediaPayload {
  version: 1
  url: string
  scope: string
  expiresAt: number
  kind: 'auto' | 'hls'
  selectedVariant?: string
  preferredAudioLanguage?: string
}

interface ControlFetchBody {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
  bodyEncoding?: 'utf8' | 'base64'
}

interface RegisterResourceBody {
  url: string
  headers?: Record<string, string>
  kind?: 'auto' | 'hls'
  selectedVariant?: string
  preferredAudioLanguage?: string
  expiresInSeconds?: number
}

interface UpstreamResult {
  response: Response
  finalUrl: string
}

const encoder = new TextEncoder()
const SESSION_KEY = 'session'
const COOKIE_KEY = 'cookies'
const MAX_REDIRECTS = 8
const DEFAULT_SESSION_TTL_SECONDS = 6 * 60 * 60
const MAX_SESSION_TTL_SECONDS = 24 * 60 * 60
const DEFAULT_MAX_PLAYLIST_BYTES = 5 * 1024 * 1024
const DEFAULT_MAX_CONTROL_BODY_BYTES = 1024 * 1024
const DEFAULT_UPSTREAM_TIMEOUT_MS = 45_000
const MAX_HEADERS = 64
const MAX_HEADER_BYTES = 32 * 1024
const MAX_COOKIES = 128
const MAX_SET_COOKIE_BYTES = 4096
const PUBLIC_RESPONSE_HEADERS = new Set([
  'accept-ranges',
  'cache-control',
  'content-disposition',
  'content-encoding',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'expires',
  'last-modified',
  'vary',
])
const CONTROL_RESPONSE_HEADERS = new Set([
  ...PUBLIC_RESPONSE_HEADERS,
  'content-language',
  'location',
])
const STRIPPED_REQUEST_HEADERS = new Set([
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
  'cf-visitor',
  'connection',
  'content-length',
  'host',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
])
const LOCATION_HINTS = new Set<LocationHint>([
  'wnam',
  'enam',
  'sam',
  'weur',
  'eeur',
  'apac',
  'apac-ne',
  'apac-se',
  'oc',
  'afr',
  'me',
])

function envInteger(
  value: string | undefined,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback
}

function json(
  data: unknown,
  status = 200,
  extraHeaders?: HeadersInit
): Response {
  const headers = new Headers(extraHeaders)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Content-Type-Options', 'nosniff')
  return new Response(JSON.stringify(data), { status, headers })
}

function errorResponse(
  error: unknown,
  requestId: string,
  corsOrigin?: string
): Response {
  const message =
    error instanceof Error ? error.message : 'Proxy request failed'
  const status = /authorized/i.test(message)
    ? 401
    : /expired/i.test(message)
      ? 410
      : /not found/i.test(message)
        ? 404
        : /invalid|unsupported|allowed|too large|malformed/i.test(message)
          ? 400
          : 502
  const response = json(
    { success: false, error: message, requestId },
    status,
    corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : undefined
  )
  response.headers.set('X-Request-ID', requestId)
  return response
}

function requestId(request: Request): string {
  return request.headers.get('cf-ray') || crypto.randomUUID()
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left)
  const b = encoder.encode(right)
  const length = Math.max(a.length, b.length)
  let mismatch = a.length ^ b.length
  for (let index = 0; index < length; index++) {
    mismatch |= (a[index] || 0) ^ (b[index] || 0)
  }
  return mismatch === 0
}

function assertServiceAuthorization(request: Request, env: Env): void {
  if (!env.SERVICE_TOKEN || env.SERVICE_TOKEN.length < 24) {
    throw new Error('Proxy service is not configured securely')
  }
  const authorization = request.headers.get('authorization') || ''
  const expected = `Bearer ${env.SERVICE_TOKEN}`
  if (!constantTimeEqual(authorization, expected)) {
    throw new Error('Not authorized')
  }
}

async function readJson<T>(request: Request, maximumBytes: number): Promise<T> {
  const declaredLength = Number(request.headers.get('content-length') || 0)
  if (declaredLength > maximumBytes)
    throw new Error('Request body is too large')
  const text = await request.text()
  if (encoder.encode(text).byteLength > maximumBytes) {
    throw new Error('Request body is too large')
  }
  try {
    return JSON.parse(text || '{}') as T
  } catch {
    throw new Error('Malformed JSON request body')
  }
}

function corsOrigin(env: Env): string {
  return env.CORS_ORIGIN?.trim() || '*'
}

function addPublicHeaders(headers: Headers, env: Env, id?: string): void {
  headers.set('Access-Control-Allow-Origin', corsOrigin(env))
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range')
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin')
  headers.set('X-Content-Type-Options', 'nosniff')
  if (id) headers.set('X-Request-ID', id)
}

function optionsResponse(env: Env): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': corsOrigin(env),
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, If-Range',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    },
  })
}

function getSessionStub(
  env: Env,
  idValue: string,
  locationHint?: LocationHint
): DurableObjectStub {
  let id: DurableObjectId
  try {
    id = env.SESSIONS.idFromString(idValue)
  } catch {
    throw new Error('Invalid session ID')
  }
  return env.SESSIONS.get(id, locationHint ? { locationHint } : undefined)
}

function publicBaseUrl(request: Request, env: Env): string {
  if (!env.PUBLIC_BASE_URL?.trim()) return new URL(request.url).origin
  const configured = new URL(env.PUBLIC_BASE_URL)
  if (configured.protocol !== 'https:' && configured.hostname !== 'localhost') {
    throw new Error('PUBLIC_BASE_URL must use HTTPS')
  }
  return configured.origin
}

async function handleTopLevel(request: Request, env: Env): Promise<Response> {
  const id = requestId(request)
  try {
    const url = new URL(request.url)
    if (url.pathname === '/health' && request.method === 'GET') {
      return json({
        success: true,
        service: 'flixquest-media-proxy',
        durableSessions: true,
      })
    }
    if (request.method === 'OPTIONS') return optionsResponse(env)

    if (url.pathname === '/v1/sessions' && request.method === 'POST') {
      assertServiceAuthorization(request, env)
      const body = await readJson<{ locationHint?: string }>(
        request,
        envInteger(env.MAX_CONTROL_BODY_BYTES, DEFAULT_MAX_CONTROL_BODY_BYTES)
      )
      const hint =
        body.locationHint &&
        LOCATION_HINTS.has(body.locationHint as LocationHint)
          ? (body.locationHint as LocationHint)
          : undefined
      if (body.locationHint && !hint) throw new Error('Invalid location hint')

      const durableId = env.SESSIONS.newUniqueId()
      const sessionId = durableId.toString()
      const stub = env.SESSIONS.get(
        durableId,
        hint ? { locationHint: hint } : undefined
      )
      const expiresAt =
        Date.now() +
        envInteger(
          env.SESSION_TTL_SECONDS,
          DEFAULT_SESSION_TTL_SECONDS,
          MAX_SESSION_TTL_SECONDS
        ) *
          1000
      const initialized = await stub.fetch('https://session.internal/init', {
        method: 'POST',
        body: JSON.stringify({ expiresAt }),
      })
      if (!initialized.ok) {
        throw new Error(`Could not initialize session (${initialized.status})`)
      }
      return json({ success: true, sessionId, expiresAt }, 201)
    }

    const match = url.pathname.match(
      /^\/v1\/sessions\/([a-f0-9]{64})\/(fetch|resources|media\/(.+))$/
    )
    if (!match) return json({ success: false, error: 'Not found' }, 404)

    const [, sessionId, operation, mediaToken] = match
    const stub = getSessionStub(env, sessionId)
    if (operation === 'fetch' || operation === 'resources') {
      assertServiceAuthorization(request, env)
      if (request.method !== 'POST') {
        return json({ success: false, error: 'Method not allowed' }, 405, {
          Allow: 'POST',
        })
      }
      const internalUrl = new URL(`https://session.internal/${operation}`)
      if (operation === 'resources') {
        internalUrl.searchParams.set('sessionId', sessionId)
        internalUrl.searchParams.set(
          'publicBaseUrl',
          publicBaseUrl(request, env)
        )
      }
      const response = await stub.fetch(internalUrl, {
        method: 'POST',
        headers: {
          'Content-Type':
            request.headers.get('content-type') || 'application/json',
          'X-Request-ID': id,
        },
        body: request.body,
      })
      const headers = new Headers(response.headers)
      headers.set('X-Request-ID', id)
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }

    if (!mediaToken || !['GET', 'HEAD'].includes(request.method)) {
      return json({ success: false, error: 'Method not allowed' }, 405, {
        Allow: 'GET, HEAD, OPTIONS',
      })
    }
    const internalUrl = `https://session.internal/media/${mediaToken}`
    const headers = new Headers()
    headers.set('X-Request-ID', id)
    for (const name of ['range', 'if-range']) {
      const value = request.headers.get(name)
      if (value) headers.set(name, value)
    }
    const response = await stub.fetch(internalUrl, {
      method: request.method,
      headers,
    })
    const publicHeaders = new Headers(response.headers)
    addPublicHeaders(publicHeaders, env, id)
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: publicHeaders,
    })
  } catch (error) {
    console.error(JSON.stringify({ requestId: id, error: String(error) }))
    return errorResponse(error, id, corsOrigin(env))
  }
}

export default {
  fetch: handleTopLevel,
} satisfies ExportedHandler<Env>

export class ProxySession {
  private signingKey?: Promise<CryptoKey>

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {}

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll()
  }

  async fetch(request: Request): Promise<Response> {
    const id = request.headers.get('x-request-id') || crypto.randomUUID()
    try {
      const url = new URL(request.url)
      if (url.pathname === '/init' && request.method === 'POST') {
        return await this.initialize(request)
      }

      const session = await this.requireSession()
      if (url.pathname === '/fetch' && request.method === 'POST') {
        return await this.controlFetch(request)
      }
      if (url.pathname === '/resources' && request.method === 'POST') {
        return await this.registerResource(request, url, session)
      }
      const mediaMatch = url.pathname.match(/^\/media\/(.+)$/)
      if (mediaMatch && ['GET', 'HEAD'].includes(request.method)) {
        return await this.proxyMedia(request, mediaMatch[1], session)
      }
      return json({ success: false, error: 'Not found' }, 404)
    } catch (error) {
      return errorResponse(error, id)
    }
  }

  private async initialize(request: Request): Promise<Response> {
    const existing = await this.state.storage.get<SessionMetadata>(SESSION_KEY)
    if (existing) return json({ success: true, expiresAt: existing.expiresAt })

    const body = await readJson<{ expiresAt?: number }>(
      request,
      DEFAULT_MAX_CONTROL_BODY_BYTES
    )
    const maximum = Date.now() + MAX_SESSION_TTL_SECONDS * 1000
    if (
      !Number.isSafeInteger(body.expiresAt) ||
      (body.expiresAt || 0) <= Date.now() ||
      (body.expiresAt || 0) > maximum
    ) {
      throw new Error('Invalid session expiry')
    }
    const metadata: SessionMetadata = {
      version: 1,
      createdAt: Date.now(),
      expiresAt: body.expiresAt!,
    }
    await this.state.storage.put(SESSION_KEY, metadata)
    await this.state.storage.setAlarm(metadata.expiresAt)
    return json({ success: true, expiresAt: metadata.expiresAt }, 201)
  }

  private async requireSession(): Promise<SessionMetadata> {
    const metadata = await this.state.storage.get<SessionMetadata>(SESSION_KEY)
    if (!metadata) throw new Error('Session not found')
    if (metadata.expiresAt <= Date.now()) {
      await this.state.storage.deleteAll()
      throw new Error('Session expired')
    }
    return metadata
  }

  private async controlFetch(request: Request): Promise<Response> {
    const body = await readJson<ControlFetchBody>(
      request,
      envInteger(
        this.env.MAX_CONTROL_BODY_BYTES,
        DEFAULT_MAX_CONTROL_BODY_BYTES
      )
    )
    const method = (body.method || 'GET').toUpperCase()
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      throw new Error('Unsupported upstream method')
    }
    const headers = sanitizeHeaders(body.headers)
    let requestBody: Uint8Array | string | undefined
    if (!['GET', 'HEAD'].includes(method) && body.body !== undefined) {
      requestBody =
        body.bodyEncoding === 'base64' ? decodeBase64(body.body) : body.body
    }

    const upstream = await this.fetchWithRedirects(
      body.url,
      method,
      headers,
      requestBody
    )
    const responseHeaders = filteredResponseHeaders(
      upstream.response.headers,
      CONTROL_RESPONSE_HEADERS
    )
    responseHeaders.set('X-Media-Proxy-Upstream-URL', upstream.finalUrl)
    responseHeaders.set('Cache-Control', 'no-store')
    return new Response(upstream.response.body, {
      status: upstream.response.status,
      statusText: upstream.response.statusText,
      headers: responseHeaders,
    })
  }

  private async registerResource(
    request: Request,
    internalUrl: URL,
    session: SessionMetadata
  ): Promise<Response> {
    const body = await readJson<RegisterResourceBody>(
      request,
      envInteger(
        this.env.MAX_CONTROL_BODY_BYTES,
        DEFAULT_MAX_CONTROL_BODY_BYTES
      )
    )
    const target = this.assertAllowedUrl(body.url)
    if (body.kind !== undefined && !['auto', 'hls'].includes(body.kind)) {
      throw new Error('Invalid resource kind')
    }
    const selectedVariant = body.selectedVariant
      ? this.assertAllowedUrl(new URL(body.selectedVariant, target).href).href
      : undefined
    if (
      body.preferredAudioLanguage !== undefined &&
      (typeof body.preferredAudioLanguage !== 'string' ||
        body.preferredAudioLanguage.length > 64)
    ) {
      throw new Error('Invalid preferred audio language')
    }
    const requestedTtl = envInteger(
      body.expiresInSeconds?.toString(),
      DEFAULT_SESSION_TTL_SECONDS,
      MAX_SESSION_TTL_SECONDS
    )
    const expiresAt = Math.min(
      session.expiresAt,
      Date.now() + requestedTtl * 1000
    )
    const scope = randomBase64Url(18)
    const sessionId = internalUrl.searchParams.get('sessionId')
    const baseUrl = internalUrl.searchParams.get('publicBaseUrl')
    if (!sessionId || !baseUrl) throw new Error('Invalid resource registration')
    const publicMediaBase = `${baseUrl}/v1/sessions/${sessionId}/media`
    await this.state.storage.put<RequestScope>(`scope:${scope}`, {
      headers: sanitizeHeaders(body.headers),
      publicMediaBase,
    })
    const payload: MediaPayload = {
      version: 1,
      url: target.href,
      scope,
      expiresAt,
      kind: body.kind || 'auto',
      selectedVariant,
      preferredAudioLanguage: body.preferredAudioLanguage,
    }
    const token = await this.encodeMediaToken(payload)
    const mediaUrl = `${publicMediaBase}/${token}`
    return json({ success: true, url: mediaUrl, expiresAt }, 201)
  }

  private async proxyMedia(
    request: Request,
    token: string,
    session: SessionMetadata
  ): Promise<Response> {
    const payload = await this.decodeMediaToken(token)
    if (payload.expiresAt > session.expiresAt) {
      throw new Error('Invalid media token')
    }
    const scope = await this.state.storage.get<RequestScope>(
      `scope:${payload.scope}`
    )
    if (!scope) throw new Error('Media resource not found')

    const headers = sanitizeHeaders(scope.headers)
    for (const name of ['range', 'if-range']) {
      const value = request.headers.get(name)
      if (value) headers[name] = value
    }
    const upstream = await this.fetchWithRedirects(
      payload.url,
      request.method,
      headers
    )
    const contentType = upstream.response.headers.get('content-type') || ''
    const isHls =
      payload.kind === 'hls' ||
      /(?:mpegurl|vnd\.apple\.mpegurl)/i.test(contentType) ||
      /\.m3u8(?:$|[?#])/i.test(upstream.finalUrl)

    if (
      request.method === 'HEAD' ||
      !upstream.response.body ||
      !upstream.response.ok ||
      !isHls
    ) {
      const responseHeaders = filteredResponseHeaders(
        upstream.response.headers,
        PUBLIC_RESPONSE_HEADERS
      )
      responseHeaders.set('Cache-Control', 'private, no-store')
      return new Response(
        request.method === 'HEAD' ? null : upstream.response.body,
        {
          status: upstream.response.status,
          statusText: upstream.response.statusText,
          headers: responseHeaders,
        }
      )
    }

    const maximumBytes = envInteger(
      this.env.MAX_PLAYLIST_BYTES,
      DEFAULT_MAX_PLAYLIST_BYTES,
      20 * 1024 * 1024
    )
    const declaredLength = Number(
      upstream.response.headers.get('content-length') || 0
    )
    if (declaredLength > maximumBytes) throw new Error('Playlist is too large')
    const playlistText = await upstream.response.text()
    if (encoder.encode(playlistText).byteLength > maximumBytes) {
      throw new Error('Playlist is too large')
    }
    if (!playlistText.includes('#EXTM3U')) {
      throw new Error('Upstream returned an invalid HLS playlist')
    }

    const rewritten = await rewriteHlsPlaylist(
      playlistText,
      upstream.finalUrl,
      async absoluteUrl =>
        `${scope.publicMediaBase}/${await this.encodeMediaToken({
          version: 1,
          url: this.assertAllowedUrl(absoluteUrl).href,
          scope: payload.scope,
          expiresAt: payload.expiresAt,
          kind: 'auto',
        })}`,
      {
        selectedVariant: payload.selectedVariant,
        preferredAudioLanguage: payload.preferredAudioLanguage,
      }
    )
    return new Response(rewritten, {
      status: upstream.response.ok ? 200 : upstream.response.status,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'private, no-store',
      },
    })
  }

  private async fetchWithRedirects(
    initialUrl: string,
    initialMethod: string,
    initialHeaders: Record<string, string>,
    initialBody?: BodyInit
  ): Promise<UpstreamResult> {
    let url = this.assertAllowedUrl(initialUrl)
    let method = initialMethod
    let body = initialBody
    let headers = { ...initialHeaders }

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const outboundHeaders = new Headers(headers)
      const cookieHeader = await this.cookieHeader(url)
      if (cookieHeader) {
        const explicitCookie = outboundHeaders.get('cookie')
        outboundHeaders.set(
          'Cookie',
          explicitCookie ? `${explicitCookie}; ${cookieHeader}` : cookieHeader
        )
      }
      const controller = new AbortController()
      const timeout = setTimeout(
        () => controller.abort(),
        envInteger(
          this.env.UPSTREAM_TIMEOUT_MS,
          DEFAULT_UPSTREAM_TIMEOUT_MS,
          5 * 60 * 1000
        )
      )
      let response: Response
      try {
        response = await fetch(url.href, {
          method,
          headers: outboundHeaders,
          body: ['GET', 'HEAD'].includes(method) ? undefined : body,
          redirect: 'manual',
          cache: 'no-store',
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeout)
      }
      await this.storeResponseCookies(response.headers, url)

      if (![301, 302, 303, 307, 308].includes(response.status)) {
        return { response, finalUrl: url.href }
      }
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location || redirects === MAX_REDIRECTS) {
        throw new Error('Invalid or excessive upstream redirects')
      }

      const nextUrl = this.assertAllowedUrl(new URL(location, url).href)
      if (nextUrl.origin !== url.origin) {
        headers = Object.fromEntries(
          Object.entries(headers).filter(
            ([name]) =>
              !['authorization', 'cookie', 'proxy-authorization'].includes(
                name.toLowerCase()
              )
          )
        )
      }
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) &&
          method === 'POST')
      ) {
        method = 'GET'
        body = undefined
        deleteHeader(headers, 'content-type')
      }
      url = nextUrl
    }
    throw new Error('Too many upstream redirects')
  }

  private assertAllowedUrl(value: string): URL {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new Error('Invalid upstream URL')
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Unsupported upstream protocol')
    }
    if (url.username || url.password) {
      throw new Error('Upstream credentials are not allowed')
    }
    if (
      url.port &&
      !['80', '443'].includes(url.port) &&
      this.env.ALLOW_NON_STANDARD_PORTS !== 'true'
    ) {
      throw new Error('Non-standard upstream ports are not allowed')
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    if (isPrivateHost(hostname)) {
      throw new Error('Private upstream destinations are not allowed')
    }
    const patterns = (this.env.ALLOWED_HOSTS || '')
      .split(',')
      .map(pattern => pattern.trim().toLowerCase())
      .filter(Boolean)
    if (
      patterns.length === 0 ||
      !patterns.some(pattern => hostMatches(hostname, pattern))
    ) {
      throw new Error(`Upstream host is not allowed: ${hostname}`)
    }
    return url
  }

  private async signingCryptoKey(): Promise<CryptoKey> {
    if (!this.env.SIGNING_SECRET || this.env.SIGNING_SECRET.length < 32) {
      throw new Error('Proxy signing secret is not configured securely')
    }
    this.signingKey ||= crypto.subtle.importKey(
      'raw',
      encoder.encode(this.env.SIGNING_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    )
    return this.signingKey
  }

  private async encodeMediaToken(payload: MediaPayload): Promise<string> {
    const encoded = encodeBase64Url(encoder.encode(JSON.stringify(payload)))
    const signature = await crypto.subtle.sign(
      'HMAC',
      await this.signingCryptoKey(),
      encoder.encode(encoded)
    )
    return `${encoded}.${encodeBase64Url(new Uint8Array(signature))}`
  }

  private async decodeMediaToken(token: string): Promise<MediaPayload> {
    const [encoded, signature, ...extra] = token.split('.')
    if (!encoded || !signature || extra.length > 0) {
      throw new Error('Malformed media token')
    }
    let valid = false
    try {
      valid = await crypto.subtle.verify(
        'HMAC',
        await this.signingCryptoKey(),
        decodeBase64Url(signature),
        encoder.encode(encoded)
      )
    } catch {
      throw new Error('Invalid media token')
    }
    if (!valid) throw new Error('Invalid media token')

    let payload: MediaPayload
    try {
      payload = JSON.parse(
        new TextDecoder().decode(decodeBase64Url(encoded))
      ) as MediaPayload
    } catch {
      throw new Error('Malformed media token')
    }
    if (
      payload.version !== 1 ||
      typeof payload.url !== 'string' ||
      typeof payload.scope !== 'string' ||
      typeof payload.expiresAt !== 'number' ||
      payload.expiresAt <= Date.now() ||
      !['auto', 'hls'].includes(payload.kind) ||
      (payload.selectedVariant !== undefined &&
        typeof payload.selectedVariant !== 'string') ||
      (payload.preferredAudioLanguage !== undefined &&
        typeof payload.preferredAudioLanguage !== 'string')
    ) {
      throw new Error('Expired or invalid media token')
    }
    this.assertAllowedUrl(payload.url)
    return payload
  }

  private async cookieHeader(url: URL): Promise<string> {
    const now = Date.now()
    const records =
      (await this.state.storage.get<CookieRecord[]>(COOKIE_KEY)) || []
    const valid = records.filter(
      cookie => !cookie.expiresAt || cookie.expiresAt > now
    )
    if (valid.length !== records.length) {
      await this.state.storage.put(COOKIE_KEY, valid)
    }
    return valid
      .filter(cookie => cookieMatches(cookie, url))
      .sort((a, b) => b.path.length - a.path.length)
      .map(cookie => `${cookie.name}=${cookie.value}`)
      .join('; ')
  }

  private async storeResponseCookies(
    headers: Headers,
    responseUrl: URL
  ): Promise<void> {
    const workerHeaders = headers as Headers & {
      getSetCookie?: () => string[]
      getAll?: (name: string) => string[]
    }
    const setCookies =
      workerHeaders.getSetCookie?.() ||
      workerHeaders.getAll?.('Set-Cookie') ||
      []
    if (setCookies.length === 0) return

    const existing =
      (await this.state.storage.get<CookieRecord[]>(COOKIE_KEY)) || []
    const now = Date.now()
    const updated = existing.filter(
      cookie => !cookie.expiresAt || cookie.expiresAt > now
    )
    for (const value of setCookies) {
      if (encoder.encode(value).byteLength > MAX_SET_COOKIE_BYTES) continue
      const parsed = parseSetCookie(value, responseUrl)
      if (!parsed) continue
      const index = updated.findIndex(
        cookie =>
          cookie.name === parsed.name &&
          cookie.domain === parsed.domain &&
          cookie.path === parsed.path
      )
      if (index >= 0) updated.splice(index, 1)
      if (!parsed.expiresAt || parsed.expiresAt > now) updated.push(parsed)
    }
    if (updated.length > MAX_COOKIES) {
      updated.splice(0, updated.length - MAX_COOKIES)
    }
    await this.state.storage.put(COOKIE_KEY, updated)
  }
}

function sanitizeHeaders(
  input: Record<string, string> | undefined
): Record<string, string> {
  if (!input) return {}
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid upstream headers')
  }
  const entries = Object.entries(input)
  if (entries.length > MAX_HEADERS) throw new Error('Too many upstream headers')

  let size = 0
  const headers = new Headers()
  for (const [name, value] of entries) {
    if (typeof value !== 'string') throw new Error('Invalid upstream header')
    const normalized = name.toLowerCase()
    if (
      STRIPPED_REQUEST_HEADERS.has(normalized) ||
      normalized.startsWith('cf-')
    ) {
      continue
    }
    size += encoder.encode(name).byteLength + encoder.encode(value).byteLength
    if (size > MAX_HEADER_BYTES)
      throw new Error('Upstream headers are too large')
    headers.set(name, value)
  }
  return Object.fromEntries(headers.entries())
}

function deleteHeader(headers: Record<string, string>, name: string): void {
  const key = Object.keys(headers).find(
    candidate => candidate.toLowerCase() === name.toLowerCase()
  )
  if (key) delete headers[key]
}

function filteredResponseHeaders(
  upstream: Headers,
  allowed: Set<string>
): Headers {
  const headers = new Headers()
  for (const [name, value] of upstream) {
    if (allowed.has(name.toLowerCase())) headers.set(name, value)
  }
  return headers
}

function hostMatches(hostname: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2)
    return hostname.endsWith(`.${suffix}`) && hostname !== suffix
  }
  return hostname === pattern
}

function isPrivateHost(hostname: string): boolean {
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return true
  }
  if (hostname.includes(':')) {
    const normalized = hostname.toLowerCase()
    if (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized)
    ) {
      return true
    }
    const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
    return mapped ? isPrivateIpv4(mapped) : false
  }
  return /^\d+\.\d+\.\d+\.\d+$/.test(hostname) ? isPrivateIpv4(hostname) : false
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number)
  if (
    parts.length !== 4 ||
    parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true
  }
  const [a, b, c] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}

function defaultCookiePath(pathname: string): string {
  if (!pathname.startsWith('/') || pathname === '/') return '/'
  const lastSlash = pathname.lastIndexOf('/')
  return lastSlash <= 0 ? '/' : pathname.slice(0, lastSlash)
}

function domainMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

function parseSetCookie(value: string, responseUrl: URL): CookieRecord | null {
  const parts = value.split(';')
  const pair = parts.shift()
  const separator = pair?.indexOf('=') ?? -1
  if (!pair || separator <= 0) return null

  const cookie: CookieRecord = {
    name: pair.slice(0, separator).trim(),
    value: pair.slice(separator + 1).trim(),
    domain: responseUrl.hostname.toLowerCase(),
    path: defaultCookiePath(responseUrl.pathname),
    hostOnly: true,
    secure: false,
  }
  if (!cookie.name) return null

  for (const rawAttribute of parts) {
    const [rawName, ...rawValue] = rawAttribute.trim().split('=')
    const name = rawName.toLowerCase()
    const attributeValue = rawValue.join('=').trim()
    if (name === 'domain' && attributeValue) {
      const domain = attributeValue.replace(/^\./, '').toLowerCase()
      if (!domainMatches(responseUrl.hostname.toLowerCase(), domain))
        return null
      cookie.domain = domain
      cookie.hostOnly = false
    } else if (name === 'path' && attributeValue.startsWith('/')) {
      cookie.path = attributeValue
    } else if (name === 'secure') {
      cookie.secure = true
    } else if (name === 'max-age' && /^-?\d+$/.test(attributeValue)) {
      cookie.expiresAt = Date.now() + Number(attributeValue) * 1000
    } else if (name === 'expires' && !cookie.expiresAt) {
      const expiresAt = Date.parse(attributeValue)
      if (Number.isFinite(expiresAt)) cookie.expiresAt = expiresAt
    }
  }
  return cookie
}

function cookieMatches(cookie: CookieRecord, url: URL): boolean {
  const hostname = url.hostname.toLowerCase()
  const domainMatch = cookie.hostOnly
    ? hostname === cookie.domain
    : domainMatches(hostname, cookie.domain)
  const pathMatch =
    url.pathname === cookie.path ||
    url.pathname.startsWith(
      cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`
    )
  return (
    domainMatch && pathMatch && (!cookie.secure || url.protocol === 'https:')
  )
}

function randomBase64Url(bytes: number): string {
  const value = new Uint8Array(bytes)
  crypto.getRandomValues(value)
  return encodeBase64Url(value)
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url data')
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  return decodeBase64(padded)
}

function decodeBase64(value: string): Uint8Array {
  let binary: string
  try {
    binary = atob(value)
  } catch {
    throw new Error('Invalid base64 request body')
  }
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}
