import type { Subtitle } from '../../types/index.js'
import { languageFlagUrl } from './flags.js'
import { defaultOutputFormat, subtitleFilePath } from './paths.js'
import { createSubtitleFileToken, type SubtitleFileToken } from './tokens.js'
import { decodeSubtitleBytes } from './vtt.js'
import type {
  SubtitleCatalogEntry,
  SubtitleProvider,
  SubtitleQuery,
} from './types.js'

const WYZIE_SUBS_BASE_URL = 'https://sub.wyzie.io'
const WYZIE_REQUEST_TIMEOUT_MS = 10_000
/** Files are served by third-party hosts that throttle bursts. */
const FILE_TIMEOUT_MS = 30_000
const MAX_FILE_BYTES = 4 * 1024 * 1024
/** Formats {@link convertSubtitle} can normalize; `sub` and `ass` cannot. */
const SUPPORTED_UPSTREAM_FORMATS = new Set(['srt', 'vtt', 'webvtt'])

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'

/**
 * Response shape from the Wyzie Subs /search endpoint.
 * Only the fields we actually use are listed here.
 */
interface WyzieSubtitleResult {
  id?: string | number
  url?: string
  display?: string
  language?: string
  format?: string
  encoding?: string
  flagUrl?: string
  media?: string
  release?: string
  fileName?: string
  isHearingImpaired?: boolean
  /** Set when the track was machine-translated. */
  ai?: boolean
}

function searchUrl(query: SubtitleQuery, apiKey: string): string {
  const params = new URLSearchParams({ id: query.tmdbId, key: apiKey })
  if (query.season !== undefined && query.episode !== undefined) {
    params.set('season', String(query.season))
    params.set('episode', String(query.episode))
  }

  return `${WYZIE_SUBS_BASE_URL}/search?${params.toString()}`
}

function isUsable(
  item: WyzieSubtitleResult
): item is WyzieSubtitleResult & { url: string } {
  return (
    typeof item.url === 'string' &&
    /^https?:\/\//i.test(item.url) &&
    SUPPORTED_UPSTREAM_FORMATS.has((item.format || 'srt').toLowerCase())
  )
}

/**
 * Map upstream results onto catalog entries served through this API.
 *
 * Wyzie hands out links to whichever aggregator hosts the file, so every entry
 * is rewritten to the passthrough route: clients never learn the upstream host,
 * and the file arrives normalized and ad-free like every other subtitle here.
 */
function toCatalog(results: WyzieSubtitleResult[]): SubtitleCatalogEntry[] {
  const format = defaultOutputFormat()
  const entries: SubtitleCatalogEntry[] = []
  let unsigned = 0

  results.filter(isUsable).forEach((item, index) => {
    const id = String(item.id ?? index)
    const language = (item.language || '').trim().toLowerCase()

    let token: string
    try {
      token = createSubtitleFileToken({
        url: item.url,
        encoding: item.encoding,
        language,
      })
    } catch {
      unsigned += 1
      return
    }

    entries.push({
      id: `wyzie-${id}`,
      url: subtitleFilePath('wyzie', id, { token }),
      display: item.display || item.language || 'Unknown',
      language,
      format,
      encoding: 'UTF-8',
      isHearingImpaired: item.isHearingImpaired === true,
      source: 'wyzie',
      flagUrl: item.flagUrl || languageFlagUrl(language),
      media: item.media || '',
      release: item.release || item.fileName,
      machineTranslated: item.ai === true,
    })
  })

  if (unsigned > 0) {
    console.warn(
      `[WyzieSubs] Dropped ${unsigned} subtitle(s): STREAM_PROXY_SECRET is not configured`
    )
  }

  return entries
}

/**
 * Fetch subtitles from the Wyzie Subs API. Requires `WYZIE_SUBS_API_KEY`.
 */
async function catalog(query: SubtitleQuery): Promise<SubtitleCatalogEntry[]> {
  const apiKey = process.env.WYZIE_SUBS_API_KEY || ''
  if (!apiKey) {
    return []
  }

  try {
    const response = await fetch(searchUrl(query, apiKey), {
      signal: AbortSignal.timeout(WYZIE_REQUEST_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      console.warn(
        `[WyzieSubs] HTTP ${response.status} from ${WYZIE_SUBS_BASE_URL}`
      )
      return []
    }

    const results: WyzieSubtitleResult[] = await response.json()

    if (!Array.isArray(results) || results.length === 0) {
      console.log('[WyzieSubs] No subtitles found')
      return []
    }

    const entries = toCatalog(results)
    console.log(`[WyzieSubs] Fetched ${entries.length} subtitle(s)`)
    return entries
  } catch (error) {
    console.warn(
      `[WyzieSubs] ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return []
  }
}

async function search(query: SubtitleQuery): Promise<Subtitle[]> {
  const entries = await catalog(query)

  return entries.map(entry => ({
    file: entry.url,
    label: entry.display,
    kind: entry.isHearingImpaired ? 'captions' : 'subtitles',
  }))
}

export const wyzieSubtitleProvider: SubtitleProvider = {
  id: 'wyzie',
  name: 'Wyzie Subs',
  catalog,
  search,
}

/**
 * Download and decode one subtitle file from the host a token points at.
 *
 * @param token Verified token minted while building the catalog
 * @returns Decoded subtitle text, still in its original format
 */
export async function fetchWyzieSubtitleFile(
  token: SubtitleFileToken
): Promise<string> {
  const response = await fetch(token.url, {
    headers: {
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'user-agent': BROWSER_USER_AGENT,
      // Aggregators gate downloads per IP; a rotating egress only adds
      // failure modes here.
      'x-skip-forward-proxy': 'true',
    },
    signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`Upstream responded with HTTP ${response.status}`)
  }

  const buffer = await response.arrayBuffer()
  if (buffer.byteLength === 0) {
    throw new Error('Upstream returned an empty subtitle file')
  }
  if (buffer.byteLength > MAX_FILE_BYTES) {
    throw new Error('Upstream subtitle file is too large')
  }

  const text = decodeSubtitleBytes(
    new Uint8Array(buffer),
    token.encoding,
    token.language
  )

  // Rejected downloads come back as a short HTML or plain-text body.
  if (!text.includes('-->')) {
    throw new Error('Upstream returned a subtitle file with no cues')
  }

  return text
}
