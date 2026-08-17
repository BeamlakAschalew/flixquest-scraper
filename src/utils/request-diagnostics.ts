const SENSITIVE_QUERY_KEYS =
  /^(?:api[_-]?key|authorization|cookie|enc|expires|hash|key|seed|signature|token)$/i

function errorProperties(error: Error): Record<string, unknown> {
  const diagnostic = error as Error & {
    code?: unknown
    errno?: unknown
    syscall?: unknown
    hostname?: unknown
    address?: unknown
    port?: unknown
    requestId?: unknown
    elapsedMs?: unknown
    targetUrl?: unknown
    proxyUrl?: unknown
    proxySource?: unknown
    proxyAddresses?: unknown
    dnsError?: unknown
    cause?: unknown
    errors?: unknown
  }

  const properties: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  }

  for (const key of [
    'code',
    'errno',
    'syscall',
    'hostname',
    'address',
    'port',
    'requestId',
    'elapsedMs',
    'targetUrl',
    'proxyUrl',
    'proxySource',
    'proxyAddresses',
    'dnsError',
  ] as const) {
    if (diagnostic[key] !== undefined) {
      properties[key] = serializeError(diagnostic[key], 1)
    }
  }

  return properties
}

function serializeError(value: unknown, depth = 0): unknown {
  if (depth >= 4) return '[max error depth reached]'
  if (value instanceof Error) {
    const properties = errorProperties(value)
    const cause = (value as Error & { cause?: unknown }).cause
    if (cause !== undefined) {
      properties.cause = serializeError(cause, depth + 1)
    }
    const errors = (value as Error & { errors?: unknown }).errors
    if (errors !== undefined) {
      properties.errors = serializeError(errors, depth + 1)
    }
    return properties
  }
  if (Array.isArray(value)) {
    return value.slice(0, 5).map(item => serializeError(item, depth + 1))
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value).slice(0, 12)) {
      output[key] = serializeError(item, depth + 1)
    }
    return output
  }
  return value
}

export function formatRequestError(error: unknown): string {
  try {
    return JSON.stringify(serializeError(error))
  } catch {
    return error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error)
  }
}

export function redactUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr)
    if (url.username) url.username = '[REDACTED]'
    if (url.password) url.password = '[REDACTED]'
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEYS.test(key)) {
        url.searchParams.set(key, '[REDACTED]')
        continue
      }

      if (key === 'url' || key === 'destination' || key === 'src') {
        const nested = url.searchParams.get(key)
        if (nested && /^https?:\/\//i.test(nested)) {
          url.searchParams.set(key, redactUrl(nested))
        }
      }
    }
    return url.href
  } catch {
    return urlStr
  }
}

export function responseDiagnostics(response: Response): string {
  const values = {
    status: response.status,
    statusText: response.statusText,
    finalUrl: redactUrl(response.url),
    contentType: response.headers.get('content-type'),
    contentLength: response.headers.get('content-length'),
    server: response.headers.get('server'),
    cfRay: response.headers.get('cf-ray'),
    via: response.headers.get('via'),
  }
  return JSON.stringify(values)
}

export async function responseBodySnippet(
  response: Response,
  maxLength = 500
): Promise<string> {
  try {
    const contentType = response.headers.get('content-type') || ''
    if (
      contentType &&
      !/(?:json|text|xml|html|javascript|mpegurl)/i.test(contentType)
    ) {
      return `[body omitted: ${contentType}]`
    }

    const body = await response.clone().text()
    return body
      .slice(0, maxLength)
      .replace(/\s+/g, ' ')
      .replace(
        /(["']?(?:api[_-]?key|token|seed|signature)["']?\s*[:=]\s*)[^,&}\s]+/gi,
        '$1[REDACTED]'
      )
  } catch (error) {
    return `[body unavailable: ${formatRequestError(error)}]`
  }
}
