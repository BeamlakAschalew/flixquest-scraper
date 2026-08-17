import type { Provider, ProviderLink } from '../types/index.js'
import {
  fetchJson,
  linkFromUrl,
  deduplicateLinks,
  isValidMediaRequest,
  playbackHeaders,
  subtitlesFrom,
  GenericStream,
} from './rabbitmeow-common.js'

interface MultiPayload {
  sources?: GenericStream[]
  streams?: GenericStream[]
  subtitles?: Array<{
    file?: string
    url?: string
    label?: string
    language?: string
  }>
}

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  if (!isValidMediaRequest(tmdbId, mediaType, season, episode)) return []

  const page = new URL('https://multiembed.mov/')
  page.searchParams.set('video_id', tmdbId)
  page.searchParams.set('tmdb', '1')
  if (mediaType === 'tv') {
    page.searchParams.set('s', String(season))
    page.searchParams.set('e', String(episode))
  }
  // MultiEmbed's current landing page is Turnstile-gated. Try its legacy
  // fetch-only JSON endpoint and fail closed if the gate rejects the request.
  // Runtime browser automation is intentionally not used.
  try {
    const endpoint = new URL('/response.php', page.origin)
    for (const [key, value] of page.searchParams) {
      endpoint.searchParams.set(key, value)
    }
    const payload = await fetchJson<MultiPayload>(endpoint.href, {
      Accept: 'application/json',
      Referer: page.href,
      'User-Agent': 'Mozilla/5.0',
    })
    const shared = subtitlesFrom(payload.subtitles || [])
    return deduplicateLinks(
      [...(payload.sources || []), ...(payload.streams || [])].flatMap(
        (stream, i) => {
          const link = linkFromUrl(
            'MultiEmbed',
            `Server ${i + 1}`,
            stream.url || stream.file || stream.playlist || '',
            stream.quality || stream.label || '',
            [
              ...shared,
              ...subtitlesFrom([
                ...(stream.subtitles || []),
                ...(stream.tracks || []),
                ...(stream.captions || []),
              ]),
            ],
            stream.headers || playbackHeaders(page.origin)
          )
          return link ? [link] : []
        }
      )
    )
  } catch (error) {
    console.warn(
      `[MultiEmbed] ${error instanceof Error ? error.message : 'Turnstile-gated endpoint'}`
    )
    return []
  }
}

export const multiEmbedProvider: Provider = {
  name: 'MultiEmbed',
  id: 'multiembed',
  streamMovie: id => getStreams(id, 'movie'),
  streamTV: (id, s, e) => getStreams(id, 'tv', s, e),
}
