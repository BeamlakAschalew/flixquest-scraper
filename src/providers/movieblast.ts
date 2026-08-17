import { createHmac } from 'node:crypto'
import type { Provider, ProviderLink } from '../types/index.js'

const BASE_URL = 'https://app.cloud-mb.xyz'
const TOKEN = 'jdvhhjv255vghhghdhvfch2565656jhdcghfdf'
const APP_ID = 'com.movieblast'
const SIGN_SECRET = 'GJ8reydarI7Jqat9rvbAJKNQ9gY4DoEQF2H5nfuI1gi'
const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
const REQUEST_TIMEOUT_MS = 12_000
const API_HEADERS = {
  'User-Agent': 'okhttp/5.0.0-alpha.6',
  'x-request-x': APP_ID,
}
const SEARCH_HEADERS = {
  ...API_HEADERS,
  hash256: '86dc03244adddb3cbedbf0ae36074a736ee293a64774b18e82a6244eafd0df30',
  packagename: APP_ID,
}

interface TmdbDetails {
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
}

interface MovieBlastResult {
  id?: string | number
  name?: string
  type?: string
  release_date?: string
}

interface MovieBlastVideo {
  link?: string
  server?: string
  lang?: string
}

interface MovieBlastEpisode {
  episode_number?: number
  videos?: MovieBlastVideo[]
}

interface MovieBlastSeason {
  season_number?: number
  episodes?: MovieBlastEpisode[]
}

interface MovieBlastPayload {
  search?: MovieBlastResult[]
  videos?: MovieBlastVideo[]
  seasons?: MovieBlastSeason[]
}

async function fetchJson<T>(
  url: string,
  headers: Record<string, string> = API_HEADERS
): Promise<T> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok)
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`)
  return response.json() as Promise<T>
}

async function getMetadata(
  tmdbId: string,
  mediaType: 'movie' | 'tv'
): Promise<{ title: string; year?: number }> {
  const apiKey = process.env.TMDB_API_KEY?.trim()
  if (!apiKey) throw new Error('TMDB_API_KEY is not configured')
  const details = await fetchJson<TmdbDetails>(
    `${TMDB_BASE_URL}/${mediaType}/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(apiKey)}`,
    { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' }
  )
  const title = mediaType === 'tv' ? details.name : details.title
  const date =
    mediaType === 'tv' ? details.first_air_date : details.release_date
  if (!title) throw new Error('TMDB returned no title')
  return { title, year: date ? Number(date.slice(0, 4)) : undefined }
}

function normalizeTitle(title = ''): string {
  return title
    .toLowerCase()
    .replace(/\b(the|a|an)\b/g, '')
    .replace(/[:\-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim()
}

function similarity(first: string, second: string): number {
  const left = normalizeTitle(first).split(/\s+/).filter(Boolean)
  const right = new Set(normalizeTitle(second).split(/\s+/).filter(Boolean))
  if (left.join(' ') === [...right].join(' ')) return 1
  const union = new Set([...left, ...right])
  return union.size
    ? left.filter(word => right.has(word)).length / union.size
    : 0
}

function findBestMatch(
  metadata: { title: string; year?: number },
  results: MovieBlastResult[]
): MovieBlastResult | undefined {
  let best: MovieBlastResult | undefined
  let bestScore = 0
  for (const result of results) {
    let score = similarity(metadata.title, result.name || '')
    const resultYear = Number(result.release_date?.slice(0, 4))
    if (metadata.year && resultYear === metadata.year) score += 0.2
    if (score > 0.4 && score > bestScore) {
      best = result
      bestScore = score
    }
  }
  return best
}

function signUrl(input: string): string {
  try {
    const url = new URL(input)
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const signature = createHmac('sha256', SIGN_SECRET)
      .update(url.pathname + timestamp)
      .digest('base64')
    return `${input}?verify=${timestamp}-${encodeURIComponent(signature)}`
  } catch {
    return input
  }
}

function qualityFromLabel(label = ''): string {
  const match = label.toLowerCase().match(/2160|4k|1440|1080|720|480|360/)
  if (!match) return 'auto'
  if (match[0] === '4k' || match[0] === '2160') return '2160p'
  return `${match[0]}p`
}

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  try {
    const metadata = await getMetadata(tmdbId, mediaType)
    const search = await fetchJson<MovieBlastPayload>(
      `${BASE_URL}/api/search/${encodeURIComponent(metadata.title)}/${TOKEN}`,
      SEARCH_HEADERS
    )
    const match = findBestMatch(metadata, search.search || [])
    if (!match?.id) return []

    const isSeries =
      mediaType === 'tv' || match.type?.toLowerCase().includes('serie')
    const endpoint = isSeries ? 'series/show' : 'media/detail'
    const details = await fetchJson<MovieBlastPayload>(
      `${BASE_URL}/api/${endpoint}/${match.id}/${TOKEN}`
    )
    let videos = details.videos || []
    if (isSeries) {
      videos =
        details.seasons
          ?.find(item => item.season_number == season)
          ?.episodes?.find(item => item.episode_number == episode)?.videos || []
    }

    const links = videos.flatMap((video, index) => {
      if (!video.link) return []
      const rawUrl = video.link.startsWith('http')
        ? video.link
        : `https://${video.link}`
      const url = signUrl(rawUrl)
      return [
        {
          server: `movieblast-${index + 1}`,
          url,
          isM3U8: /\.m3u8(?:$|[?#])/i.test(url),
          quality: qualityFromLabel(video.server),
          subtitles: [],
          headers: {
            'User-Agent': 'MovieBlast',
            Referer: 'MovieBlast',
            'x-request-x': APP_ID,
          },
        },
      ]
    })
    console.log(`[MovieBlast] Extracted ${links.length} candidate stream(s)`)
    return links
  } catch (error) {
    console.error(
      `[MovieBlast] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const movieBlastProvider: Provider = {
  name: 'MovieBlast',
  id: 'movieblast',
  alias: 'Magdala',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
