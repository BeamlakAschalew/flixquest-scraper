import type { ProviderResponse, Subtitle } from '../../types/index.js'
import { natsukiSubtitleProvider } from './natsuki.js'
import { wyzieSubtitleProvider } from './wyzie.js'
import { absoluteSubtitleUrl } from './paths.js'
import type {
  SubtitleCatalogEntry,
  SubtitleProvider,
  SubtitleProviderId,
  SubtitleQuery,
} from './types.js'

const PROVIDERS: Record<SubtitleProviderId, SubtitleProvider> = {
  natsuki: natsukiSubtitleProvider,
  wyzie: wyzieSubtitleProvider,
}

/** Natsuki first; Wyzie is a no-op unless `WYZIE_SUBS_API_KEY` is configured. */
const DEFAULT_PROVIDER_ORDER: SubtitleProviderId[] = ['natsuki', 'wyzie']

function isProviderId(value: string): value is SubtitleProviderId {
  return value === 'natsuki' || value === 'wyzie'
}

/**
 * Priority order of the fallback subtitle providers, overridable with a
 * comma-separated `SUBTITLE_PROVIDERS` (e.g. `wyzie,natsuki` or `natsuki`).
 */
export function subtitleProviderOrder(): SubtitleProviderId[] {
  const configured = (process.env.SUBTITLE_PROVIDERS || '')
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(isProviderId)

  return configured.length > 0
    ? [...new Set(configured)]
    : DEFAULT_PROVIDER_ORDER
}

/**
 * Resolve subtitles from the first configured provider that returns any.
 *
 * Intended as a **fallback** — call it only when the scraping provider returned
 * no subtitles of its own. Never throws; an exhausted provider list yields `[]`.
 *
 * @param query TMDB id, plus season/episode for TV
 */
export async function fetchFallbackSubtitles(
  query: SubtitleQuery
): Promise<Subtitle[]> {
  for (const providerId of subtitleProviderOrder()) {
    const subtitles = await PROVIDERS[providerId].search(query)
    if (subtitles.length > 0) return subtitles
  }

  return []
}

/**
 * Every subtitle every configured provider offers for one title, for clients
 * that let the viewer pick a track themselves.
 *
 * Unlike {@link fetchFallbackSubtitles} this merges all providers instead of
 * stopping at the first with results, and providers are queried concurrently
 * because none of them depends on another. Never throws.
 *
 * @param query TMDB id, plus season/episode for TV
 * @returns Entries in provider-priority order, deduplicated by id
 */
export async function fetchSubtitleCatalog(
  query: SubtitleQuery
): Promise<SubtitleCatalogEntry[]> {
  const order = subtitleProviderOrder()
  const results = await Promise.all(
    order.map(providerId => PROVIDERS[providerId].catalog(query))
  )

  const seen = new Set<string>()
  return results.flat().filter(entry => {
    if (seen.has(entry.id)) return false
    seen.add(entry.id)
    return true
  })
}

/**
 * Rewrite router-relative subtitle paths into absolute URLs.
 *
 * Applied when a response is sent — including cache hits — so a cached payload
 * always advertises the host it is served from.
 *
 * @param response   Provider response about to be sent
 * @param apiBaseUrl Public API base URL, e.g. `https://host/api/v2`
 */
export function withAbsoluteSubtitleUrls(
  response: ProviderResponse,
  apiBaseUrl: string
): ProviderResponse {
  if (!response.links?.some(link => link.subtitles?.some(hasRelativeFile))) {
    return response
  }

  return {
    ...response,
    links: response.links.map(link => ({
      ...link,
      subtitles: link.subtitles.map(subtitle =>
        hasRelativeFile(subtitle)
          ? {
              ...subtitle,
              file: absoluteSubtitleUrl(subtitle.file, apiBaseUrl),
            }
          : subtitle
      ),
    })),
  }
}

/**
 * The same rewrite as {@link withAbsoluteSubtitleUrls}, for catalog entries.
 *
 * @param entries    Catalog entries about to be sent
 * @param apiBaseUrl Public API base URL, e.g. `https://host/api/v2`
 */
export function withAbsoluteCatalogUrls(
  entries: SubtitleCatalogEntry[],
  apiBaseUrl: string
): SubtitleCatalogEntry[] {
  return entries.map(entry =>
    entry.url.startsWith('/')
      ? { ...entry, url: absoluteSubtitleUrl(entry.url, apiBaseUrl) }
      : entry
  )
}

function hasRelativeFile(subtitle: Subtitle): boolean {
  return typeof subtitle.file === 'string' && subtitle.file.startsWith('/')
}

export { SUBTITLE_ROUTE_BASE } from './paths.js'
export type {
  SubtitleCatalogEntry,
  SubtitleProviderId,
  SubtitleQuery,
} from './types.js'
