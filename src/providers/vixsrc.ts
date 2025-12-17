import type { Provider, ProviderLink, Subtitle } from '../types/index.js'

/**
 * Vixsrc streaming provider integration
 * TypeScript version - Standalone (no external dependencies)
 */

// Constants
const BASE_URL = 'https://vixsrc.to'

// Default headers for requests
const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json,*/*',
  'Accept-Language': 'en-US,en;q=0.5',
  Connection: 'keep-alive',
}

/**
 * Helper function to make HTTP requests with default headers
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
      ...options,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    return response
  } catch (error) {
    console.error(
      `[Vixsrc] Request failed for ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    throw error
  }
}

/**
 * Extract stream URL from Vixsrc page
 */
async function extractStreamFromPage(
  contentType: 'movie' | 'tv',
  contentId: string,
  seasonNum?: number,
  episodeNum?: number
): Promise<{ masterPlaylistUrl: string; subtitleApiUrl: string } | null> {
  let vixsrcUrl: string
  let subtitleApiUrl: string

  if (contentType === 'movie') {
    vixsrcUrl = `${BASE_URL}/movie/${contentId}`
    subtitleApiUrl = `https://sub.wyzie.ru/search?id=${contentId}`
  } else {
    vixsrcUrl = `${BASE_URL}/tv/${contentId}/${seasonNum}/${episodeNum}`
    subtitleApiUrl = `https://sub.wyzie.ru/search?id=${contentId}&season=${seasonNum}&episode=${episodeNum}`
  }

  console.log(`[Vixsrc] Fetching: ${vixsrcUrl}`)

  try {
    const response = await makeRequest(vixsrcUrl, {
      headers: {
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })

    const html = await response.text()
    console.log(`[Vixsrc] HTML length: ${html.length} characters`)

    let masterPlaylistUrl: string | null = null

    // Method 1: Look for window.masterPlaylist (primary method)
    if (html.includes('window.masterPlaylist')) {
      console.log('[Vixsrc] Found window.masterPlaylist')

      const urlMatch = html.match(/url:\s*['"]([^'"]+)['"]/)
      const tokenMatch = html.match(/['"]?token['"]?\s*:\s*['"]([^'"]+)['"]/)
      const expiresMatch = html.match(
        /['"]?expires['"]?\s*:\s*['"]([^'"]+)['"]/
      )

      if (urlMatch && tokenMatch && expiresMatch) {
        const baseUrl = urlMatch[1]
        const token = tokenMatch[1]
        const expires = expiresMatch[1]

        console.log('[Vixsrc] Extracted tokens:')
        console.log(`  - Base URL: ${baseUrl}`)
        console.log(`  - Token: ${token.substring(0, 20)}...`)
        console.log(`  - Expires: ${expires}`)

        // Construct the master playlist URL
        if (baseUrl.includes('?b=1')) {
          masterPlaylistUrl = `${baseUrl}&token=${token}&expires=${expires}&h=1&lang=en`
        } else {
          masterPlaylistUrl = `${baseUrl}?token=${token}&expires=${expires}&h=1&lang=en`
        }

        console.log(
          `[Vixsrc] Constructed master playlist URL: ${masterPlaylistUrl}`
        )
      }
    }

    // Method 2: Look for direct .m3u8 URLs
    if (!masterPlaylistUrl) {
      const m3u8Match = html.match(/(https?:\/\/[^'"\s]+\.m3u8[^'"\s]*)/)
      if (m3u8Match) {
        masterPlaylistUrl = m3u8Match[1]
        console.log('[Vixsrc] Found direct .m3u8 URL:', masterPlaylistUrl)
      }
    }

    // Method 3: Look for stream URLs in script tags
    if (!masterPlaylistUrl) {
      const scriptMatches = html.match(/<script[^>]*>(.*?)<\/script>/gs)
      if (scriptMatches) {
        for (const script of scriptMatches) {
          const streamMatch = script.match(
            /['"]?(https?:\/\/[^'"\s]+(?:\.m3u8|playlist)[^'"\s]*)/
          )
          if (streamMatch) {
            masterPlaylistUrl = streamMatch[1]
            console.log('[Vixsrc] Found stream in script:', masterPlaylistUrl)
            break
          }
        }
      }
    }

    if (!masterPlaylistUrl) {
      console.log('[Vixsrc] No master playlist URL found')
      return null
    }

    return { masterPlaylistUrl, subtitleApiUrl }
  } catch (error) {
    console.error(
      `[Vixsrc] Error extracting stream: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return null
  }
}

/**
 * Subtitle response interface from wyzie.ru API
 */
interface WyzieSubtitle {
  display: string
  encoding: string
  url: string
}

/**
 * Get subtitles from wyzie.ru API
 */
async function getSubtitles(subtitleApiUrl: string): Promise<Subtitle[]> {
  try {
    const response = await makeRequest(subtitleApiUrl)
    const subtitleData: WyzieSubtitle[] = await response.json()

    const subtitles: Subtitle[] = []

    // Priority order for English subtitles
    const encodingPriority = ['ASCII', 'UTF-8', 'CP1252', 'CP1250', 'CP850']

    // Find English subtitle track with best encoding
    let englishSubtitle: WyzieSubtitle | undefined
    for (const encoding of encodingPriority) {
      englishSubtitle = subtitleData.find(
        track =>
          track.display.includes('English') && track.encoding === encoding
      )
      if (englishSubtitle) break
    }

    if (englishSubtitle) {
      subtitles.push({
        file: englishSubtitle.url,
        label: englishSubtitle.display,
        kind: 'captions',
        default: true,
      })
      console.log(`[Vixsrc] Found English subtitles: ${englishSubtitle.url}`)
    }

    // Add other language subtitles
    for (const track of subtitleData) {
      if (!track.display.includes('English')) {
        subtitles.push({
          file: track.url,
          label: track.display,
          kind: 'captions',
        })
      }
    }

    console.log(`[Vixsrc] Total subtitles found: ${subtitles.length}`)
    return subtitles
  } catch (error) {
    console.log(
      `[Vixsrc] Subtitle fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return []
  }
}

/**
 * Get streams from Vixsrc
 */
async function getVixsrcStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  seasonNum?: number,
  episodeNum?: number
): Promise<ProviderLink[]> {
  console.log(
    `[Vixsrc] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`
  )

  try {
    // Extract stream from Vixsrc page
    const streamData = await extractStreamFromPage(
      mediaType,
      tmdbId,
      seasonNum,
      episodeNum
    )

    if (!streamData) {
      console.log('[Vixsrc] No stream data found')
      return []
    }

    const { masterPlaylistUrl, subtitleApiUrl } = streamData

    // Get subtitles
    const subtitles = await getSubtitles(subtitleApiUrl)

    // Return stream with master playlist
    const links: ProviderLink[] = [
      {
        server: 'vixsrc',
        url: masterPlaylistUrl,
        isM3U8: true,
        quality: 'auto',
        subtitles,
      },
    ]

    console.log('[Vixsrc] Successfully processed 1 stream with Auto quality')
    return links
  } catch (error) {
    console.error(
      `[Vixsrc] Error in getVixsrcStreams: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return []
  }
}

export const vixsrcProvider: Provider = {
  name: 'Vixsrc',
  id: 'vixsrc',

  async streamMovie(tmdbId: string): Promise<ProviderLink[]> {
    return getVixsrcStreams(tmdbId, 'movie')
  },

  async streamTV(
    tmdbId: string,
    season: number,
    episode: number
  ): Promise<ProviderLink[]> {
    return getVixsrcStreams(tmdbId, 'tv', season, episode)
  },
}
