import type { Subtitle } from '../types/index.js'

const WYZIE_SUBS_BASE_URL = 'https://sub.wyzie.io'
const WYZIE_SUBS_API_KEY = process.env.WYZIE_SUBS_API_KEY || ''
const WYZIE_REQUEST_TIMEOUT_MS = 10_000

/**
 * Response shape from the Wyzie Subs /search endpoint.
 * Only the fields we actually use are listed here.
 */
interface WyzieSubtitleResult {
  url?: string
  display?: string
  language?: string
  format?: string
  isHearingImpaired?: boolean
}

/**
 * Fetch subtitles from the Wyzie Subs API.
 *
 * This is intended as a **fallback** — call it only when the scraping provider
 * returned no subtitles of its own.
 *
 * @param tmdbId  TMDB ID of the movie or TV show
 * @param season  Season number (TV only)
 * @param episode Episode number (TV only)
 * @returns An array of `Subtitle` objects, or `[]` on any error / missing key
 */
export async function fetchWyzieSubtitles(
  tmdbId: string,
  season?: number,
  episode?: number
): Promise<Subtitle[]> {
  if (!WYZIE_SUBS_API_KEY) {
    return []
  }

  try {
    const params = new URLSearchParams({
      id: tmdbId,
      key: WYZIE_SUBS_API_KEY,
    })

    if (season !== undefined && episode !== undefined) {
      params.set('season', String(season))
      params.set('episode', String(episode))
    }

    const url = `${WYZIE_SUBS_BASE_URL}/search?${params.toString()}`

    const response = await fetch(url, {
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

    const subtitles: Subtitle[] = results
      .filter(
        (item): item is WyzieSubtitleResult & { url: string } =>
          typeof item.url === 'string' && /^https?:\/\//i.test(item.url)
      )
      .map(item => ({
        file: item.url,
        label: item.display || item.language || 'Unknown',
        kind: item.isHearingImpaired ? 'captions' : 'subtitles',
      }))

    console.log(`[WyzieSubs] Fetched ${subtitles.length} subtitle(s)`)
    return subtitles
  } catch (error) {
    console.warn(
      `[WyzieSubs] ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return []
  }
}
