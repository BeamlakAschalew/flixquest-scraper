import type { Provider, ProviderLink } from '../types/index.js'

const DOMAINS_URL =
  'https://raw.githubusercontent.com/wooodyhood/nuvio-repo/main/domains.json'
const FALLBACK_DOMAIN = 'cash'
const REQUEST_TIMEOUT_MS = 12_000
const USER_AGENT = 'Mozilla/5.0'

interface MovixSource {
  url?: string
  name?: string
  format?: string
}

interface MovixResponse {
  sources?: MovixSource[]
}

interface Endpoint {
  api: string
  referer: string
}

async function fetchJson<T>(
  url: string,
  headers: Record<string, string> = {}
): Promise<T> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok)
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`)
  return response.json() as Promise<T>
}

async function endpoint(): Promise<Endpoint> {
  let domain = FALLBACK_DOMAIN
  try {
    const domains = await fetchJson<{ movix?: string }>(DOMAINS_URL)
    if (domains.movix) domain = domains.movix
  } catch {
    // Use the known fallback domain.
  }
  return {
    api: `https://api.movix.${domain}`,
    referer: `https://movix.${domain}/`,
  }
}

function quality(label = ''): string {
  const match = label.match(/2160|4k|1080|720|480|360/i)
  if (!match) return 'HD'
  if (/2160|4k/i.test(match[0])) return '2160p'
  return `${match[0]}p`
}

async function resolveRedirect(url: string, referer: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Referer: referer },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  await response.body?.cancel()
  return response.url || url
}

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  try {
    const target = await endpoint()
    const path =
      mediaType === 'tv'
        ? `/api/purstream/tv/${encodeURIComponent(tmdbId)}/stream?season=${season || 1}&episode=${episode || 1}`
        : `/api/purstream/movie/${encodeURIComponent(tmdbId)}/stream`
    const payload = await fetchJson<MovixResponse>(`${target.api}${path}`, {
      Referer: target.referer,
    })
    const resolved = await Promise.all(
      (payload.sources || []).map(
        async (source, index): Promise<ProviderLink | null> => {
          if (!source.url || !/^https?:\/\//i.test(source.url)) return null
          const url = await resolveRedirect(source.url, target.referer)
          return {
            server: `movix-${index + 1}`,
            url,
            isM3U8:
              source.format?.toLowerCase() === 'm3u8' ||
              /\.m3u8(?:$|[?#])/i.test(url),
            quality: quality(source.name),
            subtitles: [],
            // The resolved CDN rejects Movix's site referer even though the
            // intermediate redirect requires it.
            headers: { 'User-Agent': USER_AGENT },
            requiresProxy: true,
          } satisfies ProviderLink
        }
      )
    )
    const links = resolved.filter((link): link is ProviderLink => link !== null)
    console.log(`[Movix] Extracted ${links.length} candidate stream(s)`)
    return links
  } catch (error) {
    console.error(
      `[Movix] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const movixProvider: Provider = {
  name: 'Movix',
  id: 'movix',
  alias: 'Tiya',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
