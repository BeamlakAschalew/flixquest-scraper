import type { Provider, ProviderLink, Subtitle } from '../types/index.js'
import axios from 'axios'

/**
 * ShowBox/FebBox streaming provider integration
 * Uses the FebAPI to fetch high-quality streams with multiple server options
 */

// API Configuration
const FEBAPI_BASE_URL = 'https://febapi.nuvioapp.space/api/media'
const DEFAULT_OSS_REGION = 'USA7'

// Supported OSS regions for load balancing
const OSS_REGIONS = ['USA7', 'USA6', 'USA5', 'IN1', 'EU1'] as const
type OSSRegion = (typeof OSS_REGIONS)[number]

// Default headers for requests
const DEFAULT_HEADERS = {
  'User-Agent': 'FlixQuestScraper/1.0',
  Accept: 'application/json',
}

// Cookie storage for quota management
let cookiePool: string[] = []
let currentCookieIndex = 0

// Proxy pool for load balancing
let proxyPool: string[] = []
let currentProxyIndex = 0

/**
 * Quality parsing and normalization
 */
interface QualityInfo {
  quality: string
  priority: number
}

function parseQualityFromLabel(label: string | null | undefined): QualityInfo {
  if (!label) return { quality: 'ORG', priority: 0 }

  const labelLower = String(label).toLowerCase()

  if (
    labelLower.includes('2160p') ||
    labelLower.includes('2160') ||
    labelLower.includes('4k') ||
    labelLower.includes('uhd')
  ) {
    return { quality: '2160p', priority: 5 }
  } else if (labelLower.includes('1080p') || labelLower.includes('1080')) {
    return { quality: '1080p', priority: 4 }
  } else if (labelLower.includes('720p') || labelLower.includes('720')) {
    return { quality: '720p', priority: 3 }
  } else if (labelLower.includes('480p') || labelLower.includes('480')) {
    return { quality: '480p', priority: 2 }
  } else if (labelLower.includes('360p') || labelLower.includes('360')) {
    return { quality: '360p', priority: 1 }
  } else if (labelLower.includes('hd')) {
    return { quality: '720p', priority: 3 }
  } else if (labelLower.includes('sd')) {
    return { quality: '480p', priority: 2 }
  }

  return { quality: 'ORG', priority: 0 }
}

/**
 * Extract codec/format details from version name
 */
function extractCodecDetails(text: string | null | undefined): string[] {
  if (!text || typeof text !== 'string') return []

  const details: Set<string> = new Set()
  const lowerText = text.toLowerCase()

  // Video Technologies (HDR, Dolby Vision)
  if (
    lowerText.includes('dolby vision') ||
    lowerText.includes('dovi') ||
    lowerText.includes('.dv.')
  ) {
    details.add('DV')
  }
  if (lowerText.includes('hdr10+') || lowerText.includes('hdr10plus')) {
    details.add('HDR10+')
  } else if (lowerText.includes('hdr')) {
    details.add('HDR')
  }

  // Video Codecs
  if (lowerText.includes('av1')) {
    details.add('AV1')
  } else if (
    lowerText.includes('h265') ||
    lowerText.includes('x265') ||
    lowerText.includes('hevc')
  ) {
    details.add('HEVC')
  } else if (
    lowerText.includes('h264') ||
    lowerText.includes('x264') ||
    lowerText.includes('avc')
  ) {
    details.add('H.264')
  }

  // Audio Technologies
  if (lowerText.includes('atmos')) {
    details.add('Atmos')
  }
  if (lowerText.includes('truehd') || lowerText.includes('true-hd')) {
    details.add('TrueHD')
  }
  if (
    lowerText.includes('dts-hd ma') ||
    lowerText.includes('dtshdma') ||
    lowerText.includes('dts-hdhr')
  ) {
    details.add('DTS-HD MA')
  } else if (lowerText.includes('dts-hd')) {
    details.add('DTS-HD')
  } else if (lowerText.includes('dts') && !lowerText.includes('dts-hd')) {
    details.add('DTS')
  }

  // Audio Codecs
  if (
    lowerText.includes('eac3') ||
    lowerText.includes('e-ac-3') ||
    lowerText.includes('dd+') ||
    lowerText.includes('ddplus')
  ) {
    details.add('EAC3')
  } else if (
    lowerText.includes('ac3') ||
    (lowerText.includes('dd') &&
      !lowerText.includes('dd+') &&
      !lowerText.includes('ddp'))
  ) {
    details.add('AC3')
  }

  if (lowerText.includes('aac')) details.add('AAC')
  if (lowerText.includes('opus')) details.add('Opus')

  // Bit depth
  if (lowerText.includes('10bit') || lowerText.includes('10-bit')) {
    details.add('10-bit')
  }

  return Array.from(details)
}

/**
 * Parse file size string to bytes for comparison
 */
function parseSizeToBytes(sizeString: string | null | undefined): number {
  if (!sizeString || typeof sizeString !== 'string') {
    return Number.MAX_SAFE_INTEGER
  }

  const sizeLower = sizeString.toLowerCase()
  if (sizeLower.includes('unknown') || sizeLower.includes('n/a')) {
    return Number.MAX_SAFE_INTEGER
  }

  const units: Record<string, number> = {
    gb: 1024 * 1024 * 1024,
    mb: 1024 * 1024,
    kb: 1024,
    b: 1,
  }

  const match = sizeString.match(/([\d.]+)\s*(gb|mb|kb|b)/i)
  if (match && match[1] && match[2]) {
    const value = parseFloat(match[1])
    const unit = match[2].toLowerCase()
    if (!isNaN(value) && units[unit]) {
      return Math.floor(value * units[unit])
    }
  }

  return Number.MAX_SAFE_INTEGER
}

/**
 * Build quality string with codec details
 */
function buildQualityString(
  baseQuality: string,
  codecs: string[],
  size?: string
): string {
  const parts: string[] = [baseQuality]

  if (codecs.length > 0) {
    parts.push(codecs.slice(0, 3).join(' | ')) // Limit to 3 codecs for readability
  }

  if (size && size !== 'Unknown' && size !== 'Unknown size') {
    parts.push(`[${size}]`)
  }

  return parts.join(' ')
}

/**
 * API Response Interfaces
 */
interface ShowBoxLink {
  url: string
  name?: string
  quality?: string
  size?: string
}

interface ShowBoxVersion {
  name?: string
  size?: string
  links?: ShowBoxLink[]
}

interface ShowBoxApiResponse {
  success: boolean
  versions?: ShowBoxVersion[]
  error?: string
  message?: string
}

interface CookieQuotaResult {
  ok: boolean
  remainingMB: number
  cookie: string
}

/**
 * Check quota for a FebBox cookie
 */
async function checkCookieQuota(cookie: string): Promise<CookieQuotaResult> {
  try {
    const cookieValue = cookie.startsWith('ui=') ? cookie : `ui=${cookie}`

    const response = await axios.get(
      'https://www.febbox.com/console/user_cards',
      {
        headers: {
          Cookie: cookieValue,
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: 8000,
        validateStatus: () => true,
      }
    )

    if (response.status === 200 && response.data?.data?.flow) {
      const flow = response.data.data.flow
      const remaining =
        (Number(flow.traffic_limit_mb) || 0) -
        (Number(flow.traffic_usage_mb) || 0)

      console.log(`[ShowBox] Cookie quota check: ${remaining} MB remaining`)
      return { ok: true, remainingMB: remaining, cookie }
    }
  } catch (error) {
    console.warn(
      `[ShowBox] Quota check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }

  return { ok: false, remainingMB: -1, cookie }
}

/**
 * Select the best cookie from the pool based on remaining quota
 */
async function selectBestCookie(): Promise<string | null> {
  // Always check environment variables first (in case they changed or weren't loaded initially)
  if (cookiePool.length === 0) {
    const envCookies = process.env.SHOWBOX_COOKIES || process.env.FEBBOX_COOKIE

    if (envCookies) {
      // Support comma-separated cookies
      cookiePool = envCookies
        .split(',')
        .map(c => c.trim())
        .filter(c => c.length > 0)

      if (cookiePool.length > 0) {
        console.log(
          `[ShowBox] Loaded ${cookiePool.length} cookie(s) from environment`
        )
      }
    }
  }

  if (cookiePool.length === 0) {
    console.warn(
      '[ShowBox] No cookies configured - API requires authentication!'
    )
    return null
  }

  if (cookiePool.length === 1) {
    console.log('[ShowBox] Using single configured cookie')
    return cookiePool[0]
  }

  // For multiple cookies, check quotas and select best
  console.log(`[ShowBox] Checking quota for ${cookiePool.length} cookies...`)

  const quotaResults = await Promise.all(cookiePool.map(checkCookieQuota))
  const validResults = quotaResults.filter(r => r.ok && r.remainingMB > 0)

  if (validResults.length > 0) {
    // Sort by remaining quota descending
    validResults.sort((a, b) => b.remainingMB - a.remainingMB)
    const best = validResults[0]
    console.log(
      `[ShowBox] Selected cookie with ${best.remainingMB} MB remaining`
    )
    return best.cookie
  }

  // Fallback: round-robin if all quota checks failed
  const cookie = cookiePool[currentCookieIndex % cookiePool.length]
  currentCookieIndex++
  console.log('[ShowBox] Quota checks failed, using round-robin selection')
  return cookie
}

/**
 * Load and select a proxy from the pool (round-robin)
 */
function selectProxy(): string | null {
  // Load proxies from environment if not already loaded
  if (proxyPool.length === 0) {
    const envProxies =
      process.env.SHOWBOX_PROXY_URLS || process.env.SHOWBOX_PROXY_URL_VALUE

    if (envProxies) {
      proxyPool = envProxies
        .split(',')
        .map(p => p.trim())
        .filter(p => p.length > 0)
        .map(p => {
          // Ensure proxy ends with ?destination= or appropriate query param
          if (!p.includes('destination=')) {
            return p.endsWith('?') ? `${p}destination=` : `${p}?destination=`
          }
          return p
        })

      if (proxyPool.length > 0) {
        console.log(`[ShowBox] Loaded ${proxyPool.length} proxy(ies)`)
      }
    }
  }

  if (proxyPool.length === 0) {
    return null
  }

  // Round-robin selection
  const proxy = proxyPool[currentProxyIndex % proxyPool.length]
  currentProxyIndex++
  return proxy
}

/**
 * Fetch streams from the FebAPI
 */
async function fetchShowBoxStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number,
  region: OSSRegion = DEFAULT_OSS_REGION
): Promise<ProviderLink[]> {
  // Build API URL
  let apiUrl: string

  if (mediaType === 'tv') {
    if (season === undefined || episode === undefined) {
      console.error('[ShowBox] TV shows require season and episode numbers')
      return []
    }
    apiUrl = `${FEBAPI_BASE_URL}/tv/${tmdbId}/oss=${region}/${season}/${episode}`
  } else {
    apiUrl = `${FEBAPI_BASE_URL}/movie/${tmdbId}/oss=${region}`
  }

  // Get best cookie
  const selectedCookie = await selectBestCookie()

  if (!selectedCookie) {
    console.error('[ShowBox] No cookie available - cannot proceed')
    return []
  }

  // Add cookie to URL
  const cookieValue = selectedCookie.startsWith('ui=')
    ? selectedCookie.substring(3)
    : selectedCookie
  apiUrl += `?cookie=${encodeURIComponent(cookieValue)}`

  // Get proxy if configured
  const proxy = selectProxy()
  const finalUrl = proxy ? `${proxy}${encodeURIComponent(apiUrl)}` : apiUrl

  console.log(
    `[ShowBox] Fetching from: ${proxy ? 'proxy → ' : ''}${apiUrl.replace(/\?cookie=.*/, '?cookie=***')}`
  )

  try {
    const response = await axios.get<ShowBoxApiResponse>(finalUrl, {
      headers: {
        ...DEFAULT_HEADERS,
        ...(selectedCookie && {
          Cookie: selectedCookie.startsWith('ui=')
            ? selectedCookie
            : `ui=${selectedCookie}`,
        }),
      },
      timeout: 30000,
    })

    if (!response.data?.success) {
      console.log(
        `[ShowBox] API returned unsuccessful: ${response.data?.message || response.data?.error || 'Unknown error'}`
      )
      return []
    }

    // Debug: Log raw response structure
    if (process.env.SHOWBOX_DEBUG === 'true') {
      console.log(
        '[ShowBox] Raw API response:',
        JSON.stringify(response.data, null, 2).substring(0, 1000)
      )
    }

    const streams: ProviderLink[] = []

    // Process versions array
    if (response.data.versions && Array.isArray(response.data.versions)) {
      console.log(
        `[ShowBox] Processing ${response.data.versions.length} version(s)`
      )

      for (const version of response.data.versions) {
        const versionName = version.name || 'Unknown'
        const versionSize = version.size || 'Unknown'
        const codecs = extractCodecDetails(versionName)

        console.log(
          `[ShowBox]   Version: "${versionName}" (${versionSize}) - ${version.links?.length || 0} link(s)`
        )

        // Process links for each version
        if (version.links && Array.isArray(version.links)) {
          for (const link of version.links) {
            if (!link.url) continue

            const { quality } = parseQualityFromLabel(
              link.quality || link.name || versionName
            )
            const linkSize = link.size || versionSize
            const serverName = link.name || 'Auto'

            // Build descriptive quality string
            const qualityString = buildQualityString(quality, codecs, linkSize)

            // Determine if URL is M3U8/HLS
            const isM3U8 =
              link.url.includes('.m3u8') ||
              link.url.includes('/hls/') ||
              link.url.includes('playlist')

            console.log(
              `[ShowBox]     → Added: ${serverName} - ${qualityString}`
            )

            streams.push({
              server: `ShowBox ${serverName}`,
              url: link.url,
              isM3U8,
              quality: qualityString,
              subtitles: [] as Subtitle[],
            })
          }
        }
      }
    } else {
      console.log('[ShowBox] No versions array in API response')
    }

    console.log(`[ShowBox] Extracted ${streams.length} stream(s)`)
    return streams
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(
        `[ShowBox] API error: ${error.message}${error.response ? ` (Status: ${error.response.status})` : ''}`
      )
      if (error.response?.data) {
        console.error(
          `[ShowBox] Response: ${JSON.stringify(error.response.data).substring(0, 200)}`
        )
      }
    } else {
      console.error(
        `[ShowBox] Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
    return []
  }
}

/**
 * Get streams with region fallback
 * Tries multiple OSS regions if the primary fails
 */
async function getShowBoxStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  console.log(
    `[ShowBox] Getting streams for TMDB ${mediaType}/${tmdbId}${
      season !== undefined ? ` S${season}` : ''
    }${episode !== undefined ? `E${episode}` : ''}`
  )

  // Try primary region first
  let streams = await fetchShowBoxStreams(
    tmdbId,
    mediaType,
    season,
    episode,
    DEFAULT_OSS_REGION
  )

  // If no streams found, try alternative regions
  if (streams.length === 0) {
    const alternativeRegions = OSS_REGIONS.filter(r => r !== DEFAULT_OSS_REGION)

    for (const region of alternativeRegions.slice(0, 2)) {
      // Try up to 2 alternatives
      console.log(`[ShowBox] Trying alternative region: ${region}`)
      streams = await fetchShowBoxStreams(
        tmdbId,
        mediaType,
        season,
        episode,
        region
      )

      if (streams.length > 0) {
        console.log(`[ShowBox] Found streams using region: ${region}`)
        break
      }
    }
  }

  // Sort streams by quality (highest first)
  streams.sort((a, b) => {
    const qualityA = parseQualityFromLabel(a.quality)
    const qualityB = parseQualityFromLabel(b.quality)

    // Primary sort: quality priority (descending)
    if (qualityA.priority !== qualityB.priority) {
      return qualityB.priority - qualityA.priority
    }

    // Secondary sort: file size (descending - larger files typically better quality)
    const sizeA = parseSizeToBytes(a.quality)
    const sizeB = parseSizeToBytes(b.quality)
    return sizeB - sizeA
  })

  console.log(`[ShowBox] Returning ${streams.length} sorted stream(s)`)
  return streams
}

/**
 * Configure ShowBox cookies
 * Call this to set up cookies for authenticated access with higher quotas
 */
export function configureShowBoxCookies(cookies: string | string[]): void {
  if (typeof cookies === 'string') {
    cookiePool = cookies
      .split(',')
      .map(c => c.trim())
      .filter(c => c.length > 0)
  } else if (Array.isArray(cookies)) {
    cookiePool = cookies.filter(c => c && typeof c === 'string' && c.trim())
  }
  currentCookieIndex = 0
  console.log(`[ShowBox] Configured ${cookiePool.length} cookie(s)`)
}

/**
 * Configure ShowBox proxies
 * Call this to set up proxy URLs for routing requests
 */
export function configureShowBoxProxies(proxies: string | string[]): void {
  if (typeof proxies === 'string') {
    proxyPool = proxies
      .split(',')
      .map(p => p.trim())
      .filter(p => p.length > 0)
      .map(p => {
        if (!p.includes('destination=')) {
          return p.endsWith('?') ? `${p}destination=` : `${p}?destination=`
        }
        return p
      })
  } else if (Array.isArray(proxies)) {
    proxyPool = proxies
      .filter(p => p && typeof p === 'string' && p.trim())
      .map(p => {
        if (!p.includes('destination=')) {
          return p.endsWith('?') ? `${p}destination=` : `${p}?destination=`
        }
        return p
      })
  }
  currentProxyIndex = 0
  console.log(`[ShowBox] Configured ${proxyPool.length} proxy(ies)`)
}

/**
 * ShowBox Provider Export
 */
export const showboxProvider: Provider = {
  name: 'ShowBox',
  id: 'showbox',

  async streamMovie(tmdbId: string): Promise<ProviderLink[]> {
    return getShowBoxStreams(tmdbId, 'movie')
  },

  async streamTV(
    tmdbId: string,
    season: number,
    episode: number
  ): Promise<ProviderLink[]> {
    return getShowBoxStreams(tmdbId, 'tv', season, episode)
  },
}
