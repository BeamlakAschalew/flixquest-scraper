import type { Provider, ProviderLink, Subtitle } from '../types/index.js'
import { generateMovieMedia, generateShowMedia } from '../utils/tmdb.js'
import { buildProviders } from '../utils/providers.js'

/**
 * Transform captions from @p-stream/providers format to uniform Subtitle format
 */
function transformCaptions(captions: unknown[]): Subtitle[] {
  if (!Array.isArray(captions)) return []

  return captions.map((caption: unknown) => {
    const cap = caption as {
      url?: string
      language?: string
      hasCorsRestrictions?: boolean
      type?: string
    }
    return {
      file: cap.url || '',
      label: cap.language || 'Unknown',
      kind: 'captions',
      ...(cap.language?.toLowerCase().includes('english') && { default: true }),
      s: cap.hasCorsRestrictions ? 'c' : 'm',
    }
  })
}

/**
 * Transform stream output to uniform ProviderLink format
 */
function transformStreamOutput(output: {
  sourceId: string
  embedId?: string
  stream: {
    type: string
    id: string
    playlist?: string
    qualities?: Record<string, { url: string }>
    captions?: unknown[]
  }
}): ProviderLink[] {
  const links: ProviderLink[] = []
  const subtitles = transformCaptions(output.stream.captions || [])

  if (output.stream.type === 'hls' && output.stream.playlist) {
    links.push({
      server: output.embedId || output.sourceId,
      url: output.stream.playlist,
      isM3U8: true,
      quality: 'auto',
      subtitles,
    })
  } else if (output.stream.type === 'file' && output.stream.qualities) {
    // Handle file type with multiple qualities
    const qualities = output.stream.qualities as Record<string, { url: string }>
    for (const [quality, data] of Object.entries(qualities)) {
      links.push({
        server: output.embedId || output.sourceId,
        url: data.url,
        isM3U8: false,
        quality,
        subtitles,
      })
    }
  }

  return links
}

export const pstreamProvider: Provider = {
  name: 'PStream',
  id: 'pstream',

  async streamMovie(tmdbId: string): Promise<ProviderLink[]> {
    const media = await generateMovieMedia(tmdbId)
    const providers = buildProviders()
    const output = await providers.runAll({ media })

    if (!output) {
      return []
    }

    return transformStreamOutput(
      output as {
        sourceId: string
        embedId?: string
        stream: {
          type: string
          id: string
          playlist?: string
          qualities?: Record<string, { url: string }>
          captions?: unknown[]
        }
      }
    )
  },

  async streamTV(
    tmdbId: string,
    season: number,
    episode: number
  ): Promise<ProviderLink[]> {
    const media = await generateShowMedia(tmdbId, season, episode)
    const providers = buildProviders()
    const output = await providers.runAll({ media })

    if (!output) {
      return []
    }

    return transformStreamOutput(
      output as {
        sourceId: string
        embedId?: string
        stream: {
          type: string
          id: string
          playlist?: string
          qualities?: Record<string, { url: string }>
          captions?: unknown[]
        }
      }
    )
  },
}
