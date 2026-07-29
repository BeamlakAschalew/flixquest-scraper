import { DEFAULT_REQUEST_TIMEOUT_MS } from './config.js'

type ProxyLocationHint =
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

interface SessionResponse {
  success: boolean
  sessionId: string
  expiresAt: number
}

interface ResourceResponse {
  success: boolean
  url: string
  expiresAt: number
}

export interface MediaProxyResource {
  url: string
  headers?: Record<string, string>
  kind?: 'auto' | 'hls'
  selectedVariant?: string
  preferredAudioLanguage?: string
  expiresInSeconds?: number
}

function configuration():
  | { baseUrl: string; serviceToken: string; locationHint?: ProxyLocationHint }
  | undefined {
  const baseUrl = process.env.CLOUDFLARE_MEDIA_PROXY_URL?.trim()
  const serviceToken = process.env.CLOUDFLARE_MEDIA_PROXY_TOKEN?.trim()
  if (!baseUrl && !serviceToken) return undefined
  if (!baseUrl || !serviceToken) {
    throw new Error(
      'CLOUDFLARE_MEDIA_PROXY_URL and CLOUDFLARE_MEDIA_PROXY_TOKEN must be configured together'
    )
  }

  const parsedUrl = new URL(baseUrl)
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('CLOUDFLARE_MEDIA_PROXY_URL must be an HTTP(S) URL')
  }
  const locationHint =
    process.env.CLOUDFLARE_MEDIA_PROXY_LOCATION_HINT?.trim() as
      | ProxyLocationHint
      | undefined
  return {
    baseUrl: parsedUrl.href.replace(/\/+$/, ''),
    serviceToken,
    locationHint,
  }
}

export function isCloudflareMediaProxyConfigured(): boolean {
  return configuration() !== undefined
}

export class CloudflareMediaProxySession {
  private readonly baseUrl: string
  private readonly serviceToken: string
  readonly id: string
  readonly expiresAt: number

  constructor(
    baseUrl: string,
    serviceToken: string,
    id: string,
    expiresAt: number
  ) {
    this.baseUrl = baseUrl
    this.serviceToken = serviceToken
    this.id = id
    this.expiresAt = expiresAt
  }

  private async controlRequest(
    operation: 'fetch' | 'resources',
    body: unknown
  ): Promise<Response> {
    return fetch(`${this.baseUrl}/v1/sessions/${this.id}/${operation}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.serviceToken}`,
        'Content-Type': 'application/json',
        'x-skip-forward-proxy': 'true',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS),
    })
  }

  async fetch(
    url: string,
    options: {
      method?: string
      headers?: Record<string, string>
      body?: string
      bodyEncoding?: 'utf8' | 'base64'
    } = {}
  ): Promise<Response> {
    return this.controlRequest('fetch', {
      url,
      method: options.method || 'GET',
      headers: options.headers,
      body: options.body,
      bodyEncoding: options.bodyEncoding,
    })
  }

  async register(resource: MediaProxyResource): Promise<string> {
    const response = await this.controlRequest('resources', resource)
    if (!response.ok) {
      const message = await response.text()
      throw new Error(
        `Cloudflare media proxy registration failed with HTTP ${response.status}: ${message.slice(0, 300)}`
      )
    }
    const data = (await response.json()) as Partial<ResourceResponse>
    if (!data.success || typeof data.url !== 'string') {
      throw new Error('Cloudflare media proxy returned an invalid resource URL')
    }
    return data.url
  }
}

export async function createCloudflareMediaProxySession(): Promise<CloudflareMediaProxySession> {
  const config = configuration()
  if (!config) throw new Error('Cloudflare media proxy is not configured')

  const response = await fetch(`${config.baseUrl}/v1/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.serviceToken}`,
      'Content-Type': 'application/json',
      'x-skip-forward-proxy': 'true',
    },
    body: JSON.stringify({ locationHint: config.locationHint }),
    signal: AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(
      `Cloudflare media proxy session failed with HTTP ${response.status}: ${message.slice(0, 300)}`
    )
  }
  const data = (await response.json()) as Partial<SessionResponse>
  if (
    !data.success ||
    typeof data.sessionId !== 'string' ||
    typeof data.expiresAt !== 'number'
  ) {
    throw new Error('Cloudflare media proxy returned an invalid session')
  }
  return new CloudflareMediaProxySession(
    config.baseUrl,
    config.serviceToken,
    data.sessionId,
    data.expiresAt
  )
}
