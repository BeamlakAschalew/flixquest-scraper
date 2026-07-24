/**
 * Central configuration for provider HTTP requests.
 * Can be overridden globally via environment variable: PROVIDER_TIMEOUT_MS
 */
export const DEFAULT_REQUEST_TIMEOUT_MS =
  Number(process.env.PROVIDER_TIMEOUT_MS) || 25_000
