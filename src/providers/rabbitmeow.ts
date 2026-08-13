import type { Provider, ProviderLink } from '../types/index.js'
import { primeSrcProvider } from './primesrc.js'
import { smashyStreamProvider } from './smashystream.js'
import { twoEmbedProvider } from './2embed.js'
import { multiEmbedProvider } from './multiembed.js'
import { oneElevenMoviesProvider } from './111movies.js'
import { deduplicateLinks, isValidMediaRequest } from './rabbitmeow-common.js'

const SOURCES = [
  primeSrcProvider,
  smashyStreamProvider,
  twoEmbedProvider,
  multiEmbedProvider,
  oneElevenMoviesProvider,
]

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  if (!isValidMediaRequest(tmdbId, mediaType, season, episode)) return []

  const settled = await Promise.allSettled(
    SOURCES.map(provider =>
      mediaType === 'movie'
        ? provider.streamMovie(tmdbId)
        : provider.streamTV(tmdbId, season!, episode!)
    )
  )
  settled.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn(
        `[RabbitMeow:${SOURCES[index].name}] ${result.reason instanceof Error ? result.reason.message : 'resolver failed'}`
      )
    }
  })
  return deduplicateLinks(
    settled.flatMap(result =>
      result.status === 'fulfilled' ? result.value : []
    )
  ).map(link => ({ ...link, server: `RabbitMeow | ${link.server}` }))
}

export const rabbitMeowProvider: Provider = {
  name: 'RabbitMeow',
  id: 'rabbitmeow',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
