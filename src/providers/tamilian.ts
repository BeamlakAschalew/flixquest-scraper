import * as cheerio from 'cheerio'
import type { Provider, ProviderLink } from '../types/index.js'

const EMBED_BASE_URL = 'https://embedojo.net'
const SITE_URL = 'https://tamilian.io'
const REQUEST_TIMEOUT_MS = 8_000
const CATEGORIES = [
  'tamil',
  'english',
  'hindi',
  'telugu',
  'malayalam',
  'kannada',
  'dubbed',
]
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'

interface PlayerResponse {
  securedLink?: string
  videoSource?: string
}

function unpack(
  source: string,
  radix: number,
  count: number,
  keywords: string[]
): string {
  const encode = (value: number, base: number): string => {
    if (base <= 36) return value.toString(base)
    const alphabet =
      '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
    let result = ''
    do {
      result = alphabet[value % base] + result
      value = Math.floor(value / base)
    } while (value > 0)
    return result
  }

  while (count--) {
    if (!keywords[count]) continue
    source = source.replace(
      new RegExp(`\\b${encode(count, radix)}\\b`, 'g'),
      keywords[count]
    )
  }
  return source
}

async function extractCategory(
  tmdbId: string,
  category: string
): Promise<string | undefined> {
  const pageResponse = await fetch(
    `${EMBED_BASE_URL}/${category}/tmdb/${encodeURIComponent(tmdbId)}`,
    {
      headers: { Referer: `${SITE_URL}/`, 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }
  )
  if (!pageResponse.ok) return undefined

  const $ = cheerio.load(await pageResponse.text())
  let packedScript = ''
  $('script').each((_, element) => {
    const script = $(element).html() || ''
    if (script.includes('function(p,a,c,k,e,d)')) {
      packedScript = script
      return false
    }
  })
  if (!packedScript) return undefined

  const match = packedScript.match(
    /return p\}\('(.*)',\s*(\d+),\s*(\d+),\s*'(.*?)'\.split\(/s
  )
  if (!match) return undefined

  const unpacked = unpack(
    match[1],
    Number(match[2]),
    Number(match[3]),
    match[4].split('|')
  )
  const playerId = unpacked.match(/FirePlayer\s*\(\s*["']([^"']+)["']/)?.[1]
  if (!playerId) return undefined

  const playerResponse = await fetch(
    `${EMBED_BASE_URL}/player/index.php?data=${encodeURIComponent(playerId)}&do=getVideo`,
    {
      method: 'POST',
      headers: {
        Origin: EMBED_BASE_URL,
        Referer: `${SITE_URL}/`,
        'User-Agent': USER_AGENT,
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }
  )
  if (!playerResponse.ok) return undefined
  const payload = (await playerResponse.json()) as PlayerResponse
  return payload.securedLink || payload.videoSource
}

async function getMovieStreams(tmdbId: string): Promise<ProviderLink[]> {
  const attempts = await Promise.allSettled(
    CATEGORIES.map(category => extractCategory(tmdbId, category))
  )
  const streamUrl = attempts.find(
    (attempt): attempt is PromiseFulfilledResult<string> =>
      attempt.status === 'fulfilled' &&
      typeof attempt.value === 'string' &&
      /^https?:\/\//i.test(attempt.value)
  )?.value
  if (!streamUrl) return []

  return [
    {
      server: 'tamilian-1',
      url: streamUrl,
      isM3U8: /\.m3u8(?:$|[?#])/i.test(streamUrl),
      quality: '1080p',
      subtitles: [],
      headers: {
        Origin: EMBED_BASE_URL,
        Referer: `${SITE_URL}/`,
        'User-Agent': USER_AGENT,
      },
    },
  ]
}

export const tamilianProvider: Provider = {
  name: 'Tamilian',
  id: 'tamilian',
  streamMovie: async tmdbId => {
    try {
      const links = await getMovieStreams(tmdbId)
      console.log(`[Tamilian] Extracted ${links.length} candidate stream(s)`)
      return links
    } catch (error) {
      console.error(
        `[Tamilian] ${error instanceof Error ? error.message : 'Unknown provider error'}`
      )
      return []
    }
  },
  streamTV: async () => [],
}
