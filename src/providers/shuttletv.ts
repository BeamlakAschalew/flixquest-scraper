import type { Provider } from '../types/index.js'
import { resolveShuttleTvStreams } from '../sources/shuttletv.js'

export const shuttleTvProvider: Provider = {
  id: 'shuttletv',
  name: 'Shuttle',
  alias: 'Gumma',
  content: 'English',
  streamMovie: tmdbId => resolveShuttleTvStreams('movie', tmdbId),
  streamTV: (tmdbId, season, episode) =>
    resolveShuttleTvStreams('tv', tmdbId, season, episode),
}
