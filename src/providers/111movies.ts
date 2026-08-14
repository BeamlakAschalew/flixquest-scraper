import type { Provider, ProviderLink } from '../types/index.js'
import {
  linkFromUrl,
  deduplicateLinks,
  isValidMediaRequest,
  playbackHeaders,
  subtitlesFrom,
} from './rabbitmeow-common.js'

interface VidLoveQuality {
  quality?: string
  label?: string
  codec?: string
  type?: string
  url?: string
  file?: string
}
interface VidLovePayload {
  subtitles?: Array<{
    label?: string
    display?: string
    language?: string
    file?: string
    url?: string
    type?: string
  }>
  source?: {
    source?: string
    label?: string
    url?: string
    file?: string
    type?: string
    quality?: string
    qualities?: VidLoveQuality[]
  }
}

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  if (!isValidMediaRequest(tmdbId, mediaType, season, episode)) return []

  const request =
    mediaType === 'movie'
      ? `https://ballerinacappuccinalovestungtungtungsahur.com/movie?id=${tmdbId}&mode=json&sources=moviebox&hevc=1`
      : `https://ballerinacappuccinalovestungtungtungsahur.com/tv?id=${tmdbId}&season=${season}&episode=${episode}&mode=json&sources=moviebox&hevc=1`
  try {
    const response = await fetch(request, {
      headers: {
        Accept: 'application/json',
        Referer: 'https://player.vidlove.cc/',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
        'Sec-CH-UA':
          '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
        'Sec-CH-UA-Mobile': '?0',
        'Sec-CH-UA-Platform': '"macOS"',
      },
      signal: AbortSignal.timeout(45_000),
    })
    if (!response.ok) return []
    const payload = (await response.json()) as VidLovePayload
    if (!payload.source) return []
    const subtitles = subtitlesFrom(payload.subtitles || [])
    const entries = [
      ...(payload.source.qualities || []),
      {
        quality: payload.source.quality,
        type: payload.source.type,
        url: payload.source.url,
        file: payload.source.file,
      },
    ]
    return deduplicateLinks(
      entries.flatMap((entry, index) => {
        const link = linkFromUrl(
          '111Movies',
          `${payload.source!.label || payload.source!.source || 'VidLove'} ${entry.codec ? `[${entry.codec.toUpperCase()}] ` : ''}${index + 1}`,
          entry.url || entry.file || '',
          entry.quality || entry.label || '',
          subtitles,
          playbackHeaders('https://player.vidlove.cc')
        )
        return link ? [link] : []
      })
    )
  } catch (error) {
    console.warn(
      `[111Movies] ${error instanceof Error ? error.message : 'request failed'}`
    )
    return []
  }
}

export const oneElevenMoviesProvider: Provider = {
  name: '111Movies',
  id: '111movies',
  alias: 'Debre Libanos',
  streamMovie: id => getStreams(id, 'movie'),
  streamTV: (id, s, e) => getStreams(id, 'tv', s, e),
}
