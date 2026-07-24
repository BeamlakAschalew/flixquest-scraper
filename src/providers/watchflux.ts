import type { Provider, ProviderLink } from '../types/index.js'
import { getCinebyNeonStreams } from './cineby.js'

// WatchFlux server-renders one direct source named "neon". The resolver is
// shared with Cineby, while these headers match WatchFlux's actual player.
const WATCHFLUX_ORIGIN = 'https://watchflux.tv'
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
const PLAYBACK_HEADERS = {
  Accept: '*/*',
  Origin: WATCHFLUX_ORIGIN,
  Referer: `${WATCHFLUX_ORIGIN}/`,
  'User-Agent': USER_AGENT,
}

function formatWatchFluxLinks(links: ProviderLink[]): ProviderLink[] {
  return links.map((link, index) => ({
    ...link,
    server: `WatchFlux | Neon | ${index + 1}`,
    // The live master playlists currently expose one 1280x720 rendition.
    quality: link.quality === 'Auto' ? '720p' : link.quality,
    headers: PLAYBACK_HEADERS,
    requiresProxy: true,
  }))
}

async function getWatchFluxStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  const links = await getCinebyNeonStreams(tmdbId, mediaType, season, episode)
  return formatWatchFluxLinks(links)
}

export const watchFluxProvider: Provider = {
  name: 'WatchFlux',
  id: 'watchflux',
  streamMovie: tmdbId => getWatchFluxStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getWatchFluxStreams(tmdbId, 'tv', season, episode),
}
