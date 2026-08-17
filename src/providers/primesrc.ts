import type { Provider, ProviderLink } from '../types/index.js'
import {
  RABBIT_HEADERS,
  fetchJson,
  linkFromUrl,
  deduplicateLinks,
  isValidMediaRequest,
  playbackHeaders,
  subtitlesFrom,
} from './rabbitmeow-common.js'

interface PrimeServer {
  name?: string
  key?: string
  file_name?: string | null
  file_size?: string | null
  quality?: string | null
  audio_language?: string | null
}
interface PrimeSources {
  servers?: PrimeServer[]
}
interface PrimeLink {
  link?: string
  url?: string
  file?: string
  sources?: Array<{ file?: string; url?: string; label?: string }>
  tracks?: Array<{
    file?: string
    url?: string
    label?: string
    language?: string
    kind?: string
  }>
  subtitles?: Array<{
    file?: string
    url?: string
    label?: string
    language?: string
    kind?: string
  }>
}

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  if (!isValidMediaRequest(tmdbId, mediaType, season, episode)) return []

  const embed =
    mediaType === 'movie'
      ? `https://primesrc.me/embed/movie?tmdb=${tmdbId}`
      : `https://primesrc.me/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}`
  const query = new URL(embed).searchParams
  query.set('type', mediaType)
  try {
    const sources = await fetchJson<PrimeSources>(
      `https://primesrc.me/api/v1/s?${query}`,
      { ...RABBIT_HEADERS, Accept: 'application/json', Referer: embed }
    )
    const settled = await Promise.allSettled(
      (sources.servers || [])
        .filter(s => s.key)
        .map(async server => {
          const response = await fetch(
            `https://primesrc.me/api/v1/l?key=${encodeURIComponent(server.key!)}`,
            {
              headers: {
                ...RABBIT_HEADERS,
                Accept: 'application/json',
                Referer: embed,
              },
              signal: AbortSignal.timeout(45_000),
            }
          )
          if (
            !response.ok ||
            !/json/i.test(response.headers.get('content-type') || '')
          )
            return []
          const payload = (await response.json()) as PrimeLink
          const subtitles = subtitlesFrom([
            ...(payload.subtitles || []),
            ...(payload.tracks || []),
          ])
          const quality =
            server.quality ||
            server.file_name ||
            server.file_size ||
            payload.sources?.[0]?.label ||
            ''
          return [
            payload.link,
            payload.url,
            payload.file,
            ...(payload.sources || []).flatMap(s => [s.file, s.url]),
          ].flatMap((value, index) => {
            const link = linkFromUrl(
              'PrimeSrc',
              `${server.name || 'Server'} ${index + 1}${server.audio_language ? ` [${server.audio_language.toUpperCase()}]` : ''}`,
              value || '',
              quality,
              subtitles,
              playbackHeaders('https://primesrc.me')
            )
            return link ? [link] : []
          })
        })
    )
    return deduplicateLinks(
      settled.flatMap(r => (r.status === 'fulfilled' ? r.value : []))
    )
  } catch (error) {
    console.warn(
      `[PrimeSrc] ${error instanceof Error ? error.message : 'request failed'}`
    )
    return []
  }
}

export const primeSrcProvider: Provider = {
  name: 'PrimeSrc',
  id: 'primesrc',
  streamMovie: id => getStreams(id, 'movie'),
  streamTV: (id, s, e) => getStreams(id, 'tv', s, e),
}
