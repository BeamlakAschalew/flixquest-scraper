import { createHmac, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'

/**
 * Long enough to outlive a viewing session, short enough that a leaked URL
 * stops working. Upstream download links may expire sooner on their own.
 */
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000

/** Decoded contents of a subtitle file token. */
export interface SubtitleFileToken {
  /** Upstream subtitle file URL. */
  url: string
  /** Encoding reported by the provider, used as a decoding hint. */
  encoding?: string
  /** ISO 639 language code, used as a decoding hint. */
  language?: string
  /** Expiry as epoch milliseconds. */
  expires: number
}

function signingSecret(): string {
  const secret =
    process.env.STREAM_PROXY_SECRET?.trim() || process.env.TMDB_API_KEY?.trim()
  if (!secret) {
    throw new Error('STREAM_PROXY_SECRET is not configured')
  }
  return secret
}

function sign(value: string): string {
  return createHmac('sha256', signingSecret()).update(value).digest('base64url')
}

/**
 * Reject loopback, link-local and RFC 1918 destinations.
 *
 * Upstream URLs are supplied by third-party APIs, so an SSRF-shaped response
 * must not turn this server into a probe of its own network. Hostnames are
 * checked syntactically; the signature is what actually authorizes a fetch.
 */
function isPublicHttpUrl(value: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false

  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host) return false
  if (host === 'localhost' || host.endsWith('.localhost')) return false
  if (host.endsWith('.local') || host.endsWith('.internal')) return false

  const version = isIP(host)
  if (version === 0) return true
  if (version === 6) return isPublicIpv6(host)
  return isPublicIpv4(host)
}

function isPublicIpv4(host: string): boolean {
  const [a, b] = host.split('.').map(Number)
  if (a === 0 || a === 10 || a === 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  return true
}

function isPublicIpv6(host: string): boolean {
  if (host === '::' || host === '::1') return false
  // Unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd]/.test(host) || /^fe[89ab]/.test(host)) return false
  // IPv4-mapped addresses inherit the IPv4 rules.
  const mapped = /^::ffff:((?:\d{1,3}\.){3}\d{1,3})$/.exec(host)
  return mapped ? isPublicIpv4(mapped[1]) : true
}

/**
 * Sign an upstream subtitle URL so the passthrough route can fetch it later.
 *
 * Only URLs this server minted are accepted back, which keeps the route from
 * doubling as an open proxy.
 *
 * @throws When signing is not configured or the URL is not publicly routable
 */
export function createSubtitleFileToken(
  token: Omit<SubtitleFileToken, 'expires'>
): string {
  if (!isPublicHttpUrl(token.url)) {
    throw new Error('Refusing to sign a non-public subtitle URL')
  }

  const payload = Buffer.from(
    JSON.stringify({
      url: token.url,
      encoding: token.encoding,
      language: token.language,
      expires: Date.now() + TOKEN_TTL_MS,
    } satisfies SubtitleFileToken)
  ).toString('base64url')

  return `${payload}.${sign(payload)}`
}

/**
 * Verify and decode a token created by {@link createSubtitleFileToken}.
 *
 * @throws When the token is malformed, unsigned, expired or points somewhere
 *         it should not
 */
export function decodeSubtitleFileToken(token: string): SubtitleFileToken {
  const [encoded, signature, ...extra] = token.split('.')
  if (!encoded || !signature || extra.length > 0) {
    throw new Error('Malformed subtitle token')
  }

  const expected = Buffer.from(sign(encoded))
  const received = Buffer.from(signature)
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    throw new Error('Invalid subtitle token')
  }

  const payload = JSON.parse(
    Buffer.from(encoded, 'base64url').toString('utf8')
  ) as SubtitleFileToken

  if (
    !payload ||
    typeof payload.url !== 'string' ||
    typeof payload.expires !== 'number' ||
    payload.expires < Date.now() ||
    (payload.encoding !== undefined && typeof payload.encoding !== 'string') ||
    (payload.language !== undefined && typeof payload.language !== 'string') ||
    !isPublicHttpUrl(payload.url)
  ) {
    throw new Error('Expired or invalid subtitle token')
  }

  return payload
}
