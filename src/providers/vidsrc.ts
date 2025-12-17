import type { Provider, ProviderLink, Subtitle } from '../types/index.js'

/**
 * VidSrc streaming provider integration
 * TypeScript version - Standalone
 */

// Constants
const SOURCE_URL = 'https://vidsrc.xyz/embed'
let BASEDOM = 'https://cloudnestra.com'

// Default headers for requests
const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'sec-ch-ua':
    '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
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
      ...options,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    return response
  } catch (error) {
    console.error(
      `[VidSrc] Request failed for ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    throw error
  }
}

/**
 * Parse HTML to extract server information
 */
interface ServerInfo {
  name: string
  dataHash: string | null
}

async function serversLoad(
  html: string
): Promise<{ servers: ServerInfo[]; title: string }> {
  const servers: ServerInfo[] = []
  let title = ''

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/)
  if (titleMatch) {
    title = titleMatch[1].trim()
  }

  // Extract base domain from iframe
  const iframeSrcMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/)
  if (iframeSrcMatch) {
    const baseFrameSrc = iframeSrcMatch[1]
    try {
      const fullUrl = baseFrameSrc.startsWith('//')
        ? 'https:' + baseFrameSrc
        : baseFrameSrc
      BASEDOM = new URL(fullUrl).origin
      console.log(`[VidSrc] Updated BASEDOM to: ${BASEDOM}`)
    } catch (e) {
      // Fallback regex for origin
      const originMatch = (
        baseFrameSrc.startsWith('//') ? 'https:' + baseFrameSrc : baseFrameSrc
      ).match(/^(https?:\/\/[^/]+)/)
      if (originMatch && originMatch[1]) {
        BASEDOM = originMatch[1]
        console.log(
          `[VidSrc] Updated BASEDOM via regex fallback to: ${BASEDOM}`
        )
      }
    }
  }

  // Extract servers
  const serverRegex =
    /<div[^>]+class=["'][^"']*server[^"']*["'][^>]*data-hash=["']([^"']*)["'][^>]*>([^<]+)<\/div>/g
  let match
  while ((match = serverRegex.exec(html)) !== null) {
    servers.push({
      name: match[2].trim(),
      dataHash: match[1] || null,
    })
  }

  return { servers, title }
}

/**
 * Parse master M3U8 playlist
 */
interface StreamQuality {
  quality: string
  url: string
}

async function parseMasterM3U8(
  m3u8Content: string,
  masterM3U8Url: string
): Promise<StreamQuality[]> {
  const lines = m3u8Content.split('\n').map(line => line.trim())
  const streams: StreamQuality[] = []

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXT-X-STREAM-INF:')) {
      const infoLine = lines[i]
      let quality = 'unknown'

      const resolutionMatch = infoLine.match(/RESOLUTION=(\d+x\d+)/)
      if (resolutionMatch) {
        quality = resolutionMatch[1]
      } else {
        const bandwidthMatch = infoLine.match(/BANDWIDTH=(\d+)/)
        if (bandwidthMatch) {
          quality = `${Math.round(parseInt(bandwidthMatch[1]) / 1000)}kbps`
        }
      }

      if (
        i + 1 < lines.length &&
        lines[i + 1] &&
        !lines[i + 1].startsWith('#')
      ) {
        const streamUrlPart = lines[i + 1]
        try {
          const fullStreamUrl = new URL(streamUrlPart, masterM3U8Url).href
          streams.push({ quality, url: fullStreamUrl })
        } catch (e) {
          console.error(
            `[VidSrc] Error constructing URL for stream: ${streamUrlPart}`,
            e
          )
          streams.push({ quality, url: streamUrlPart })
        }
        i++
      }
    }
  }

  // Sort by quality (highest first)
  streams.sort((a, b) => {
    const getHeight = (q: string) => {
      const match = q.match(/(\d+)x(\d+)/)
      return match ? parseInt(match[2], 10) : 0
    }
    return getHeight(b.quality) - getHeight(a.quality)
  })

  return streams
}

/**
 * Handle PRORCP extraction
 */
async function PRORCPhandler(prorcp: string): Promise<StreamQuality[] | null> {
  try {
    const prorcpUrl = `${BASEDOM}/prorcp/${prorcp}`
    console.log(`[VidSrc] Fetching PRORCP: ${prorcpUrl}`)

    const prorcpFetch = await makeRequest(prorcpUrl, {
      headers: {
        'sec-fetch-dest': 'script',
        'sec-fetch-mode': 'no-cors',
        'sec-fetch-site': 'same-origin',
        Referer: `${BASEDOM}/`,
        'Referrer-Policy': 'origin',
      },
    })

    const prorcpResponse = await prorcpFetch.text()
    const regex = /file:\s*'([^']*)'/gm
    const match = regex.exec(prorcpResponse)

    if (match && match[1]) {
      const masterM3U8Url = match[1]
      console.log(`[VidSrc] Found master M3U8: ${masterM3U8Url}`)

      const m3u8FileFetch = await makeRequest(masterM3U8Url, {
        headers: { Referer: prorcpUrl, Accept: '*/*' },
      })

      const m3u8Content = await m3u8FileFetch.text()
      return parseMasterM3U8(m3u8Content, masterM3U8Url)
    }

    console.warn('[VidSrc] No master M3U8 URL found in prorcp response')
    return null
  } catch (error) {
    console.error(
      `[VidSrc] Error in PRORCPhandler: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return null
  }
}

/**
 * Handle SRCRCP extraction
 */
async function SRCRCPhandler(
  srcrcpPath: string,
  refererForSrcrcp: string
): Promise<StreamQuality[] | null> {
  try {
    const srcrcpUrl = BASEDOM + srcrcpPath
    console.log(`[VidSrc] Fetching SRCRCP: ${srcrcpUrl}`)

    const response = await makeRequest(srcrcpUrl, {
      headers: {
        'sec-fetch-dest': 'iframe',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        Referer: refererForSrcrcp,
        'Referrer-Policy': 'origin',
      },
    })

    const responseText = await response.text()

    // Method 1: Check for "file: '...'"
    const fileRegex = /file:\s*'([^']*)'/gm
    const fileMatch = fileRegex.exec(responseText)
    if (fileMatch && fileMatch[1]) {
      const masterM3U8Url = fileMatch[1]
      console.log(`[VidSrc] Found M3U8 URL (file match): ${masterM3U8Url}`)

      const m3u8FileFetch = await makeRequest(masterM3U8Url, {
        headers: { Referer: srcrcpUrl, Accept: '*/*' },
      })

      const m3u8Content = await m3u8FileFetch.text()
      return parseMasterM3U8(m3u8Content, masterM3U8Url)
    }

    // Method 2: Check if response is M3U8 playlist directly
    if (responseText.trim().startsWith('#EXTM3U')) {
      console.log('[VidSrc] Response is M3U8 playlist directly')
      return parseMasterM3U8(responseText, srcrcpUrl)
    }

    // Method 3: Look for M3U8 URLs in script tags
    const scriptRegex = /<script[^>]*>(.*?)<\/script>/gs
    const scriptMatches = responseText.matchAll(scriptRegex)

    for (const scriptMatch of scriptMatches) {
      const scriptContent = scriptMatch[1]

      // Try various patterns
      const patterns = [
        /sources\s*[:=]\s*\[.*?file\s*:\s*['"]([^'"]+)['"]/s,
        /file\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i,
        /src\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i,
        /loadSource\(['"]([^'"]+\.m3u8[^'"]*)['"]\)/i,
        /['"](https?:\/\/[^'"\s]+\.m3u8[^'"\s]*)['"]/i,
      ]

      for (const pattern of patterns) {
        const match = scriptContent.match(pattern)
        if (match && match[1]) {
          const m3u8Url = match[1]
          console.log(`[VidSrc] Found M3U8 URL in script: ${m3u8Url}`)

          const absoluteM3u8Url = m3u8Url.startsWith('http')
            ? m3u8Url
            : new URL(m3u8Url, srcrcpUrl).href

          const m3u8FileFetch = await makeRequest(absoluteM3u8Url, {
            headers: { Referer: srcrcpUrl, Accept: '*/*' },
          })

          const m3u8Content = await m3u8FileFetch.text()
          return parseMasterM3U8(m3u8Content, absoluteM3u8Url)
        }
      }
    }

    console.warn(`[VidSrc] No stream found for SRCRCP: ${srcrcpUrl}`)
    return null
  } catch (error) {
    console.error(
      `[VidSrc] Error in SRCRCPhandler: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return null
  }
}

/**
 * Extract RCP data from HTML
 */
async function rcpGrabber(html: string): Promise<{
  metadata: { image: string }
  data: string
} | null> {
  const regex = /src:\s*'([^']*)'/
  const match = html.match(regex)
  if (!match || !match[1]) return null
  return { metadata: { image: '' }, data: match[1] }
}

/**
 * Build URL for embed page
 */
function getUrl(id: string, type: 'movie' | 'tv'): string {
  if (type === 'movie') {
    return `${SOURCE_URL}/movie/${id}`
  } else {
    const arr = id.split(':')
    return `${SOURCE_URL}/tv/${arr[0]}/${arr[1]}-${arr[2]}`
  }
}

/**
 * Main function to get stream content
 */
async function getStreamContent(
  id: string,
  type: 'movie' | 'tv'
): Promise<ProviderLink[]> {
  const url = getUrl(id, type)
  console.log(`[VidSrc] Fetching embed page: ${url}`)

  try {
    const embedRes = await makeRequest(url, {
      headers: { Referer: SOURCE_URL },
    })
    const embedResp = await embedRes.text()
    const { servers, title } = await serversLoad(embedResp)

    console.log(`[VidSrc] Found ${servers.length} servers`)

    // Process servers in parallel
    const serverPromises = servers.map(async server => {
      if (!server.dataHash) return null

      try {
        const rcpUrl = `${BASEDOM}/rcp/${server.dataHash}`
        const rcpRes = await makeRequest(rcpUrl, {
          headers: {
            'sec-fetch-dest': 'iframe',
            Referer: url,
          },
        })

        const rcpHtml = await rcpRes.text()
        const rcpData = await rcpGrabber(rcpHtml)

        if (!rcpData || !rcpData.data) {
          console.warn(`[VidSrc] Skipping server ${server.name} - no rcp data`)
          return null
        }

        let streamDetails: StreamQuality[] | null = null

        if (rcpData.data.startsWith('/prorcp/')) {
          streamDetails = await PRORCPhandler(
            rcpData.data.replace('/prorcp/', '')
          )
        } else if (rcpData.data.startsWith('/srcrcp/')) {
          // Skip known problematic servers
          if (server.name === 'Superembed' || server.name === '2Embed') {
            console.warn(
              `[VidSrc] Skipping known problematic server: ${server.name}`
            )
            return null
          }
          streamDetails = await SRCRCPhandler(rcpData.data, rcpUrl)
        } else {
          console.warn(
            `[VidSrc] Unhandled rcp data type for ${server.name}: ${rcpData.data.substring(0, 50)}`
          )
          return null
        }

        if (streamDetails && streamDetails.length > 0) {
          return streamDetails.map(stream => ({
            server: server.name,
            url: stream.url,
            isM3U8: true,
            quality: stream.quality,
            subtitles: [] as Subtitle[], // VidSrc doesn't provide subtitles directly
          }))
        }

        return null
      } catch (e) {
        console.error(
          `[VidSrc] Error processing server ${server.name}: ${e instanceof Error ? e.message : 'Unknown error'}`
        )
        return null
      }
    })

    const results = await Promise.all(serverPromises)

    // Flatten and filter valid results
    const allLinks: ProviderLink[] = []
    for (const result of results) {
      if (result && Array.isArray(result)) {
        allLinks.push(...result)
      }
    }

    console.log(`[VidSrc] Found ${allLinks.length} total stream links`)
    return allLinks
  } catch (error) {
    console.error(
      `[VidSrc] Error in getStreamContent: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return []
  }
}

export const vidsrcProvider: Provider = {
  name: 'VidSrc',
  id: 'vidsrc',

  async streamMovie(tmdbId: string): Promise<ProviderLink[]> {
    // VidSrc uses IMDB IDs, but we'll try with TMDB ID
    return getStreamContent(tmdbId, 'movie')
  },

  async streamTV(
    tmdbId: string,
    season: number,
    episode: number
  ): Promise<ProviderLink[]> {
    // Format: tmdbId:season:episode
    const id = `${tmdbId}:${season}:${episode}`
    return getStreamContent(id, 'tv')
  },
}
