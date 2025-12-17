import type { Provider, ProviderLink, Subtitle } from '../types/index.js'

/**
 * VidZee streaming provider integration
 * TypeScript version - Standalone
 */

// Constants
const VIDZEE_API_BASE = 'https://player.vidzee.wtf/api/server'
const VIDZEE_REFERER = 'https://core.vidzee.wtf/'

// Default headers for requests
const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: VIDZEE_REFERER,
}

/**
 * Helper function to make HTTP requests
 */
async function makeRequest(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = {
    ...DEFAULT_HEADERS,
    ...(options.headers as Record<string, string>),
  }

  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      signal: AbortSignal.timeout(7000), // 7 second timeout
      ...options,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    return response
  } catch (error) {
    console.error(
      `[VidZee] Request failed for ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    throw error
  }
}

/**
 * API response interfaces
 */
interface VidZeeSourceItem {
  link: string
  name?: string
  type?: string
  language?: string
  lang?: string
}

interface VidZeeApiResponse {
  url?: VidZeeSourceItem[]
  link?: string
  tracks?: unknown
  name?: string
  type?: string
  language?: string
  lang?: string
}

/**
 * Get streams from VidZee for a specific server
 */
async function getStreamsFromServer(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  server: number,
  seasonNum?: number,
  episodeNum?: number
): Promise<ProviderLink[]> {
  let targetApiUrl = `${VIDZEE_API_BASE}?id=${tmdbId}&sr=${server}`

  if (mediaType === 'tv' && seasonNum && episodeNum) {
    targetApiUrl += `&ss=${seasonNum}&ep=${episodeNum}`
  }

  console.log(`[VidZee] Fetching from server ${server}: ${targetApiUrl}`)

  try {
    const response = await makeRequest(targetApiUrl)
    const responseData: VidZeeApiResponse = await response.json()

    if (!responseData || typeof responseData !== 'object') {
      console.error(`[VidZee S${server}] Invalid response data from API`)
      return []
    }

    let apiSources: VidZeeSourceItem[] = []

    // Handle different response formats
    if (responseData.url && Array.isArray(responseData.url)) {
      apiSources = responseData.url
    } else if (responseData.link && typeof responseData.link === 'string') {
      // Single link response - wrap it as a source item
      apiSources = [
        {
          link: responseData.link,
          name: responseData.name,
          type: responseData.type,
          language: responseData.language || responseData.lang,
        },
      ]
    }

    if (!apiSources || apiSources.length === 0) {
      console.log(`[VidZee S${server}] No stream sources found in API response`)
      return []
    }

    const streams: ProviderLink[] = apiSources
      .filter(sourceItem => sourceItem.link)
      .map(sourceItem => {
        // Prefer sourceItem.name as label, fallback to sourceItem.type, then 'VidZee'
        const label = sourceItem.name || sourceItem.type || 'VidZee'
        // Ensure quality has 'p' if it's a resolution, or keep it as is
        const quality = String(label).match(/^\d+$/) ? `${label}p` : label

        return {
          server: `VidZee S${server}`,
          url: sourceItem.link,
          isM3U8: sourceItem.link.includes('.m3u8'),
          quality: quality,
          subtitles: [] as Subtitle[], // VidZee tracks are removed/not supported
        }
      })

    console.log(
      `[VidZee S${server}] Successfully extracted ${streams.length} streams`
    )
    return streams
  } catch (error) {
    console.error(
      `[VidZee S${server}] Error fetching: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return []
  }
}

/**
 * Main function to get VidZee streams from multiple servers
 */
async function getVidZeeStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  seasonNum?: number,
  episodeNum?: number
): Promise<ProviderLink[]> {
  console.log(
    `[VidZee] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`
  )

  // VidZee servers to try
  const servers = [3, 4, 5]

  try {
    // Fetch from all servers in parallel
    const streamPromises = servers.map(server =>
      getStreamsFromServer(tmdbId, mediaType, server, seasonNum, episodeNum)
    )

    const allStreamsNested = await Promise.all(streamPromises)
    const allStreams = allStreamsNested.flat()

    console.log(
      `[VidZee] Found a total of ${allStreams.length} streams from servers ${servers.join(', ')}`
    )
    return allStreams
  } catch (error) {
    console.error(
      `[VidZee] Error in getVidZeeStreams: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return []
  }
}

export const vidzeeProvider: Provider = {
  name: 'VidZee',
  id: 'vidzee',

  async streamMovie(tmdbId: string): Promise<ProviderLink[]> {
    return getVidZeeStreams(tmdbId, 'movie')
  },

  async streamTV(
    tmdbId: string,
    season: number,
    episode: number
  ): Promise<ProviderLink[]> {
    return getVidZeeStreams(tmdbId, 'tv', season, episode)
  },
}
