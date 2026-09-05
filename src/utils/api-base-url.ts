import type { Request } from 'express'

/** Mount path of the versioned API router. */
export const API_PREFIX = '/api/v2'

/**
 * Public API base URL (e.g. `https://host/api/v2`) used to materialize
 * router-relative paths such as subtitle files. Set `PUBLIC_BASE_URL` when the
 * API sits behind a proxy that does not forward `Host`/`X-Forwarded-Proto`.
 */
export function apiBaseUrl(req: Request): string {
  const configured = (process.env.PUBLIC_BASE_URL || '').trim()
  const origin = configured
    ? configured.replace(/\/+$/, '')
    : `${req.protocol}://${req.get('host')}`

  return `${origin}${API_PREFIX}`
}
