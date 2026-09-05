import type { Provider } from '../types/index.js'
import { resolveShuttleTvStreams } from '../sources/shuttletv.js'
import { withForcedForwardProxy } from '../utils/forward-proxy.js'

export const shuttleTvProvider: Provider = {
  id: 'shuttletv',
  name: 'Shuttle',
  alias: 'Gumma',
  content: 'English',
  streamMovie: tmdbId =>
    withForcedForwardProxy(() => resolveShuttleTvStreams('movie', tmdbId)),
  streamTV: (tmdbId, season, episode) =>
    withForcedForwardProxy(() =>
      resolveShuttleTvStreams('tv', tmdbId, season, episode)
    ),
}
