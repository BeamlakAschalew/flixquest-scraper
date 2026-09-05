import type { SubtitleOutputFormat, SubtitleProviderId } from './types.js'

/**
 * Mount path of the subtitle passthrough router, relative to the API router
 * (i.e. the full path is `${API_PREFIX}${SUBTITLE_ROUTE_BASE}`).
 */
export const SUBTITLE_ROUTE_BASE = '/subtitles'

const DEFAULT_OUTPUT_FORMAT: SubtitleOutputFormat = 'vtt'

/**
 * Wire format handed to clients in `subtitles[].file`.
 *
 * WebVTT is the default because browsers only accept it in `<track>` elements;
 * set `SUBTITLE_OUTPUT_FORMAT=srt` for clients that parse SubRip themselves.
 */
export function defaultOutputFormat(): SubtitleOutputFormat {
  return process.env.SUBTITLE_OUTPUT_FORMAT?.trim().toLowerCase() === 'srt'
    ? 'srt'
    : DEFAULT_OUTPUT_FORMAT
}

/**
 * Build the router-relative path that serves one upstream subtitle file.
 *
 * Paths stay relative until a response is sent so cached provider responses are
 * not pinned to the host that happened to populate the cache.
 *
 * @param provider Provider that owns the subtitle id
 * @param id       Provider-specific subtitle id
 * @param options  `language` is a hint for legacy encoding detection; `token`
 *                 carries the signed upstream URL for providers whose files are
 *                 not addressable by id alone
 */
export function subtitleFilePath(
  provider: SubtitleProviderId,
  id: string,
  options: { language?: string; token?: string } = {}
): string {
  const format = defaultOutputFormat()
  const params = new URLSearchParams()
  if (options.language) params.set('l', options.language)
  if (options.token) params.set('t', options.token)

  const query = params.toString()
  return `${SUBTITLE_ROUTE_BASE}/${provider}/${id}.${format}${
    query ? `?${query}` : ''
  }`
}

/**
 * Resolve a router-relative subtitle path against the public API base URL
 * (e.g. `https://host/api/v2`). Absolute URLs — Wyzie serves its own files —
 * are returned untouched.
 */
export function absoluteSubtitleUrl(file: string, apiBaseUrl: string): string {
  if (!file.startsWith('/')) return file
  return `${apiBaseUrl.replace(/\/+$/, '')}${file}`
}
