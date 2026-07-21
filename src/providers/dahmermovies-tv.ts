import axios from 'axios'
import type { Provider, ProviderLink } from '../types/index.js'
import { findDahmerShowDirectories } from '../utils/dahmer-directory.js'

const TMDB_API_URL = 'https://api.themoviedb.org/3'
const DAHMER_MOVIES_API = 'https://a.111477.xyz'
const REQUEST_TIMEOUT_MS = 15_000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const REQUEST_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  Referer: `${DAHMER_MOVIES_API}/`,
}

interface TmdbDetails {
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
  origin_country?: string[]
}

interface DirectoryLink {
  href: string
  text: string
}

function parseLinks(html: string): DirectoryLink[] {
  const links: DirectoryLink[] = []
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let rowMatch: RegExpExecArray | null

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const match = rowMatch[1].match(
      /<a[^>]*href=["']([^"']*)["'][^>]*>([^<]*)<\/a>/i
    )
    if (!match) continue

    const text = match[2].trim()
    if (match[1] !== '../' && /\.(mkv|mp4|avi|webm|m3u8)$/i.test(text)) {
      links.push({ href: match[1], text })
    }
  }

  return links
}

async function directoryPaths(
  title: string,
  year: string,
  season?: number,
  country?: string
): Promise<string[]> {
  const cleanTitle = title.replace(/:/g, '')
  if (season === undefined) {
    return [`/movies/${encodeURIComponent(`${cleanTitle} (${year})`)}/`]
  }

  const roots = await findDahmerShowDirectories(title, year, country)
  return roots.flatMap(root => [
    `${root}Season%20${season}/`,
    ...(season >= 10
      ? []
      : [`${root}Season%20${String(season).padStart(2, '0')}/`]),
  ])
}

async function getDahmerTvStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  const apiKey = process.env.TMDB_API_KEY?.trim()
  if (!apiKey) {
    console.error('[DahmerMovies-TV] TMDB_API_KEY is not configured')
    return []
  }

  try {
    const tmdb = await axios.get<TmdbDetails>(
      `${TMDB_API_URL}/${mediaType}/${encodeURIComponent(tmdbId)}`,
      { params: { api_key: apiKey }, timeout: REQUEST_TIMEOUT_MS }
    )
    const title = tmdb.data.title || tmdb.data.name
    const year = (
      tmdb.data.release_date ||
      tmdb.data.first_air_date ||
      ''
    ).slice(0, 4)
    if (!title) return []

    let directoryUrl = ''
    let html = ''
    for (const path of await directoryPaths(
      title,
      year,
      season,
      tmdb.data.origin_country?.[0]
    )) {
      const candidate = new URL(path, DAHMER_MOVIES_API).href
      try {
        const response = await axios.get<string>(candidate, {
          headers: REQUEST_HEADERS,
          timeout: REQUEST_TIMEOUT_MS,
          responseType: 'text',
        })
        if (parseLinks(response.data).length > 0) {
          directoryUrl = candidate
          html = response.data
          break
        }
      } catch {
        // Try the next known season-directory spelling.
      }
    }
    if (!html) return []

    let links = parseLinks(html)
    if (season !== undefined && episode !== undefined) {
      const episodePattern = new RegExp(
        `(?:S0?${season})?E0?${episode}(?:\\D|$)|episode[\\s._-]*0?${episode}(?:\\D|$)`,
        'i'
      )
      links = links.filter(link => episodePattern.test(link.text))
    }

    links.sort(
      (a, b) =>
        Number(/2160p|4k/i.test(b.text)) - Number(/2160p|4k/i.test(a.text))
    )

    const results = links.slice(0, 5).map(link => {
      const url = new URL(link.href, directoryUrl).href
      const quality = /2160p|4k/i.test(link.text) ? '2160p' : '1080p'

      return {
        server: 'DahmerMovies-TV',
        url,
        isM3U8: /\.m3u8(?:$|[?#])/i.test(url),
        quality,
        subtitles: [],
        headers: {
          'User-Agent': USER_AGENT,
          Referer: `${DAHMER_MOVIES_API}/`,
          Range: 'bytes=0-',
        },
      } satisfies ProviderLink
    })

    return Array.from(new Map(results.map(link => [link.url, link])).values())
  } catch (error) {
    console.error(
      `[DahmerMovies-TV] Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return []
  }
}

export const dahmerMoviesTvProvider: Provider = {
  name: 'DahmerMovies-TV',
  id: 'dahmermovies-tv',
  streamMovie: tmdbId => getDahmerTvStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getDahmerTvStreams(tmdbId, 'tv', season, episode),
}
