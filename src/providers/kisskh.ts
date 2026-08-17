import type { Provider, ProviderLink, Subtitle } from '../types/index.js'

const BASE_URL = 'https://kisskh.ovh'
const KEY_API =
  'https://script.google.com/macros/s/AKfycbzn8B31PuDxzaMa9_CQ0VGEDasFqfzI5bXvjaIZH4DM8DNq9q6xj1ALvZNz_JT3jF0suA/exec'
const TMDB_URL = 'https://api.themoviedb.org/3'
const REQUEST_TIMEOUT_MS = 15_000
const HEADERS = {
  Accept: 'application/json, text/plain, */*',
  Referer: `${BASE_URL}/`,
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}

interface TmdbDetails {
  title?: string
  name?: string
  original_title?: string
  original_name?: string
  release_date?: string
  first_air_date?: string
  seasons?: Array<{ season_number?: number; episode_count?: number }>
}

interface SearchItem {
  id?: number | string
  title?: string
  name?: string
}

interface KissEpisode {
  id?: number | string
  number?: number | string
  episodeNumber?: number | string
  name?: string
}

interface DramaDetails {
  episodes?: KissEpisode[]
}

interface KeyResponse {
  key?: string
}

interface KissSource {
  Video?: string
  ThirdParty?: string
  video?: string
  thirdParty?: string
  subtitles?: Array<{
    src?: string
    file?: string
    label?: string
    language?: string
  }>
}

async function fetchJson<T>(
  url: string,
  headers: Record<string, string> = {}
): Promise<T> {
  const response = await fetch(url, {
    headers: { ...HEADERS, ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`)
  }
  return (await response.json()) as T
}

function tmdbApiKey(): string | undefined {
  return process.env.TMDB_API_KEY?.trim() || undefined
}

async function getTmdbDetails(
  tmdbId: string,
  mediaType: 'movie' | 'tv'
): Promise<TmdbDetails> {
  const apiKey = tmdbApiKey()
  if (!apiKey) throw new Error('TMDB_API_KEY is not configured')
  return fetchJson<TmdbDetails>(
    `${TMDB_URL}/${mediaType}/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(apiKey)}`
  )
}

function normalize(value = ''): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function similarity(target: string, candidate: string): number {
  const left = normalize(target)
  const right = normalize(candidate)
  if (!left || !right) return 0
  if (left === right) return 1
  if (left.includes(right) || right.includes(left)) return 0.9

  const leftWords = new Set(left.split(' ').filter(word => word.length > 1))
  const rightWords = new Set(right.split(' ').filter(word => word.length > 1))
  const overlap = [...leftWords].filter(word => rightWords.has(word)).length
  return overlap / Math.max(leftWords.size, rightWords.size)
}

async function findDrama(
  details: TmdbDetails
): Promise<SearchItem | undefined> {
  const titles = Array.from(
    new Set(
      [
        details.title,
        details.name,
        details.original_title,
        details.original_name,
      ].filter((value): value is string => Boolean(value?.trim()))
    )
  )

  const candidates: SearchItem[] = []
  for (const title of titles) {
    const results = await fetchJson<SearchItem[]>(
      `${BASE_URL}/api/DramaList/Search?q=${encodeURIComponent(title)}&type=0`
    ).catch(() => [])
    candidates.push(...results)
    if (
      results.some(
        item => similarity(title, item.title || item.name || '') >= 1
      )
    )
      break
  }

  const year = (details.release_date || details.first_air_date || '').slice(
    0,
    4
  )
  return candidates
    .filter(item => item.id !== undefined)
    .map(item => {
      const candidateTitle = item.title || item.name || ''
      let score = Math.max(
        ...titles.map(title => similarity(title, candidateTitle))
      )
      if (year && candidateTitle.includes(year)) score += 0.1
      return { item, score }
    })
    .filter(result => result.score >= 0.55)
    .sort((left, right) => right.score - left.score)[0]?.item
}

function episodeNumber(item: KissEpisode): number | undefined {
  const direct = Number(item.number ?? item.episodeNumber)
  if (Number.isFinite(direct) && direct > 0) return direct
  const match = item.name?.match(/\b(?:episode|ep)\s*(\d+)\b/i)
  return match ? Number(match[1]) : undefined
}

function absoluteEpisode(
  details: TmdbDetails,
  season: number,
  episode: number
): number {
  const priorEpisodes = (details.seasons || [])
    .filter(
      item =>
        Number(item.season_number) > 0 && Number(item.season_number) < season
    )
    .reduce((total, item) => total + Number(item.episode_count || 0), 0)
  return priorEpisodes + episode
}

function selectEpisode(
  episodes: KissEpisode[],
  mediaType: 'movie' | 'tv',
  details: TmdbDetails,
  season = 1,
  episode = 1
): KissEpisode | undefined {
  if (mediaType === 'movie') {
    return episodes.length === 1 ? episodes[0] : episodes.at(-1)
  }

  const requested =
    season > 1 ? absoluteEpisode(details, season, episode) : episode
  return (
    episodes.find(item => episodeNumber(item) === requested) ||
    (season === 1
      ? episodes.find(item => episodeNumber(item) === episode)
      : undefined)
  )
}

function subtitlesFrom(source: KissSource): Subtitle[] {
  return (source.subtitles || []).flatMap(item => {
    const file = item.src || item.file
    if (!file || !/^https?:\/\//i.test(file)) return []
    return [
      {
        file,
        label: item.language || item.label || 'English',
        kind: 'captions',
      },
    ]
  })
}

function qualityFromUrl(url: string): string {
  const match = url.match(/\b(2160|1080|720|480|360)p?\b/i)
  return match ? `${match[1]}p` : 'Auto'
}

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  try {
    const details = await getTmdbDetails(tmdbId, mediaType)
    const match = await findDrama(details)
    if (!match?.id) return []

    const drama = await fetchJson<DramaDetails>(
      `${BASE_URL}/api/DramaList/Drama/${encodeURIComponent(String(match.id))}?isq=false`
    )
    const selected = selectEpisode(
      drama.episodes || [],
      mediaType,
      details,
      season,
      episode
    )
    if (!selected?.id) return []

    const key = await fetchJson<KeyResponse>(
      `${KEY_API}?id=${encodeURIComponent(String(selected.id))}&version=2.8.10`
    )
    if (!key.key) return []

    const source = await fetchJson<KissSource>(
      `${BASE_URL}/api/DramaList/Episode/${encodeURIComponent(String(selected.id))}.png?err=false&ts=&time=&kkey=${encodeURIComponent(key.key)}`
    )
    const subtitles = subtitlesFrom(source)
    const urls = [
      source.Video,
      source.ThirdParty,
      source.video,
      source.thirdParty,
    ].filter((value): value is string => Boolean(value))

    return Array.from(new Set(urls)).flatMap((url, index) => {
      if (!/^https?:\/\//i.test(url)) return []
      return [
        {
          server: `Kisskh | Original audio | English subtitles | ${index + 1}`,
          url,
          isM3U8: /\.m3u8(?:$|[?#])/i.test(url),
          quality: qualityFromUrl(url),
          subtitles,
          headers: {
            Origin: BASE_URL,
            Referer: `${BASE_URL}/`,
            'User-Agent': HEADERS['User-Agent'],
          },
        },
      ]
    })
  } catch (error) {
    console.error(
      `[Kisskh] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const kisskhProvider: Provider = {
  name: 'Kisskh',
  id: 'kisskh',
  alias: 'Chelenqo',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
