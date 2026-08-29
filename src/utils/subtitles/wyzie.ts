import type { Subtitle } from '../../types/index.js'
import type { SubtitleProvider, SubtitleQuery } from './types.js'

const WYZIE_SUBS_BASE_URL = 'https://sub.wyzie.io'
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
 * Wyzie serves its own files, so the returned URLs are absolute and bypass the
 * subtitle passthrough route. Requires `WYZIE_SUBS_API_KEY`.
 */
async function search(query: SubtitleQuery): Promise<Subtitle[]> {
  const apiKey = process.env.WYZIE_SUBS_API_KEY || ''
  if (!apiKey) {
    return []
  }

  try {
    const params = new URLSearchParams({
      id: query.tmdbId,
      key: apiKey,
    })

    if (query.season !== undefined && query.episode !== undefined) {
      params.set('season', String(query.season))
      params.set('episode', String(query.episode))
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

export const wyzieSubtitleProvider: SubtitleProvider = {
  id: 'wyzie',
  name: 'Wyzie Subs',
  search,
}
