import type { Provider, ProviderLink } from '../types/index.js'
import { cinebyProvider } from './cineby.js'
import { vidNestProvider } from './vidnest.js'
import { vidsrcProvider } from './vidsrc.js'
import {
  deduplicateLinks,
  isValidMediaRequest,
  prefixLinks,
} from './rabbitmeow-common.js'

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  if (!isValidMediaRequest(tmdbId, mediaType, season, episode)) return []

  const calls =
    mediaType === 'movie'
      ? [
          cinebyProvider.streamMovie(tmdbId),
          vidNestProvider.streamMovie(tmdbId),
          vidsrcProvider.streamMovie(tmdbId),
        ]
      : [
          cinebyProvider.streamTV(tmdbId, season!, episode!),
          vidNestProvider.streamTV(tmdbId, season!, episode!),
          vidsrcProvider.streamTV(tmdbId, season!, episode!),
        ]
  const settled = await Promise.allSettled(calls)
  const names = ['Cineby/vnest', 'VidNest', 'VidSrc/xps']
  return deduplicateLinks(
    settled.flatMap((result, index) =>
      result.status === 'fulfilled'
        ? prefixLinks(`2Embed | ${names[index]}`, result.value)
        : []
    )
  )
}

export const twoEmbedProvider: Provider = {
  name: '2Embed',
  id: '2embed',
  streamMovie: id => getStreams(id, 'movie'),
  streamTV: (id, s, e) => getStreams(id, 'tv', s, e),
}
