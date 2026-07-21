import type { Provider, ProviderLink } from '../types/index.js'

const ADDON_URL = 'https://arunjunan07-csx-stremio.hf.space/stream'
const TMDB_URL = 'https://api.themoviedb.org/3'
const TMDB_TIMEOUT_MS = 10_000
// The Hugging Face relay can cold-start after being idle.
const ADDON_TIMEOUT_MS = 35_000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

interface ExternalIdsResponse {
  imdb_id?: string
}

interface StremioStream {
  name?: string
  title?: string
  url?: string
  behaviorHints?: { proxyHeaders?: { request?: Record<string, string> } }
}

interface StremioResponse {
  streams?: StremioStream[]
}

async function getImdbId(
  tmdbId: string,
  mediaType: 'movie' | 'tv'
): Promise<string> {
  const apiKey = process.env.TMDB_API_KEY?.trim()
  if (!apiKey) throw new Error('TMDB_API_KEY is not configured')

  const url = new URL(
    `${TMDB_URL}/${mediaType}/${encodeURIComponent(tmdbId)}/external_ids`
  )
  url.searchParams.set('api_key', apiKey)
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TMDB_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`TMDB external IDs HTTP ${response.status}`)
  const data = (await response.json()) as ExternalIdsResponse
  if (!data.imdb_id) throw new Error('TMDB did not return an IMDb ID')
  return data.imdb_id
}

function qualityFromTitle(value = ''): string {
  return (
    value.match(/(?:2160|1080|720|480|360)p|4k/i)?.[0].toLowerCase() || 'auto'
  )
}

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  try {
    const imdbId = await getImdbId(tmdbId, mediaType)
    const stremioType = mediaType === 'tv' ? 'series' : 'movie'
    const id = mediaType === 'tv' ? `${imdbId}:${season}:${episode}` : imdbId
    const response = await fetch(
      `${ADDON_URL}/${stremioType}/${encodeURIComponent(id)}.json`,
      {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(ADDON_TIMEOUT_MS),
      }
    )
    if (!response.ok) throw new Error(`Addon HTTP ${response.status}`)

    const payload = (await response.json()) as StremioResponse
    const streams = (payload.streams || []).flatMap((stream, index) => {
      if (!stream.url || !/^https?:\/\//i.test(stream.url)) return []
      const label = `${stream.name || ''} ${stream.title || ''}`.trim()
      return [
        {
          server: `bollyflix-${index + 1}`,
          url: stream.url,
          isM3U8: /\.m3u8(?:$|[?#])/i.test(stream.url),
          quality: qualityFromTitle(label),
          subtitles: [],
          headers: stream.behaviorHints?.proxyHeaders?.request,
        },
      ]
    })
    console.log(`[BollyFlix] Extracted ${streams.length} candidate stream(s)`)
    return streams
  } catch (error) {
    console.error(
      `[BollyFlix] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const bollyFlixProvider: Provider = {
  name: 'BollyFlix',
  id: 'bollyflix',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
