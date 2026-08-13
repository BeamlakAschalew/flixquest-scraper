import type { Provider, ProviderLink } from '../types/index.js'
import {
  deduplicateLinks,
  isValidMediaRequest,
  prefixLinks,
} from './rabbitmeow-common.js'
import { vidNestProvider } from './vidnest.js'
import { vixsrcProvider } from './vixsrc.js'
import { xPassProvider } from './xpass.js'
import { vidRockProvider } from './vidrock.js'
import { vidUpProvider } from './vidup.js'

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  if (!isValidMediaRequest(tmdbId, mediaType, season, episode)) return []

  // SmashyStream now redirects to AnyEmbed, whose public player exposes a
  // multi-provider server list. Resolve the corresponding upstream protocols
  // directly instead of depending on AnyEmbed's browser-only Turnstile session.
  const upstreams = [
    ['VidNest', vidNestProvider],
    ['VixSrc', vixsrcProvider],
    ['XPass', xPassProvider],
    ['VidRock', vidRockProvider],
    ['VidUp', vidUpProvider],
  ] as const
  const settled = await Promise.allSettled(
    upstreams.map(([, provider]) =>
      mediaType === 'movie'
        ? provider.streamMovie(tmdbId)
        : provider.streamTV(tmdbId, season!, episode!)
    )
  )
  return deduplicateLinks(
    settled.flatMap((result, index) =>
      result.status === 'fulfilled'
        ? prefixLinks(`SmashyStream | ${upstreams[index][0]}`, result.value)
        : []
    )
  )
}

export const smashyStreamProvider: Provider = {
  name: 'SmashyStream',
  id: 'smashystream',
  streamMovie: id => getStreams(id, 'movie'),
  streamTV: (id, s, e) => getStreams(id, 'tv', s, e),
}
