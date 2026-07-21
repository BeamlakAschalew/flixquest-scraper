import axios from 'axios'
import type { Provider, ProviderLink } from '../types/index.js'
import { findDahmerShowDirectories } from '../utils/dahmer-directory.js'

const TMDB_API_URL = 'https://api.themoviedb.org/3'
const DAHMER_MOVIES_API = 'https://a.111477.xyz'
const DAHMER_WORKER_API = 'https://p.111477.xyz/bulk'
const REQUEST_TIMEOUT_MS = 10_000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const REQUEST_HEADERS = {
  'User-Agent': USER_AGENT,
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
  text: string
  href: string
  size: string
}

interface DirectoryResult {
  html: string
  url: string
}

function getTmdbApiKey(): string | undefined {
  const apiKey = process.env.TMDB_API_KEY?.trim()
  return apiKey || undefined
}

function parseLinks(html: string): DirectoryLink[] {
  const links: DirectoryLink[] = []
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let rowMatch: RegExpExecArray | null

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const row = rowMatch[1]
    const linkMatch = row.match(
      /<a[^>]*href=["']([^"']*)["'][^>]*>([^<]*)<\/a>/i
    )
    const sizeMatch = row.match(/<td[^>]*>(\d+(?:\.\d+)?\s?[KMGT]B)<\/td>/i)

    if (!linkMatch) continue

    const href = linkMatch[1]
    const text = linkMatch[2].trim()
    if (!text || href === '../' || !/\.(mkv|mp4|avi|webm|m3u8)$/i.test(text)) {
      continue
    }

    links.push({
      text,
      href,
      size: sizeMatch?.[1].trim() || 'N/A',
    })
  }

  return links
}

function buildDirectoryPaths(
  title: string,
  year: string,
  season?: number,
  country?: string
): string[] {
  const cleanTitle = title.replace(/:/g, '')

  if (season !== undefined) {
    const paddedSeason = String(season).padStart(2, '0')
    const countryLabel = country === 'GB' ? 'UK' : country
    const titles = Array.from(
      new Set([
        ...(countryLabel ? [`${cleanTitle} (${countryLabel})`] : []),
        cleanTitle,
      ])
    )
    return titles.flatMap(candidate => [
      `/tvs/${encodeURIComponent(candidate)}/Season%20${paddedSeason}/`,
      `/tvs/${encodeURIComponent(candidate)}/Season%20${season}/`,
    ])
  }

  return [`/movies/${encodeURIComponent(`${cleanTitle} (${year})`)}/`]
}

async function buildTvDirectoryPaths(
  title: string,
  year: string,
  season: number,
  country?: string
): Promise<string[]> {
  const roots = await findDahmerShowDirectories(title, year, country)
  return roots.flatMap(root => [
    `${root}Season%20${season}/`,
    ...(season >= 10
      ? []
      : [`${root}Season%20${String(season).padStart(2, '0')}/`]),
  ])
}

async function fetchDirectory(
  title: string,
  year: string,
  season?: number,
  country?: string
): Promise<DirectoryResult | null> {
  const paths =
    season === undefined
      ? buildDirectoryPaths(title, year)
      : await buildTvDirectoryPaths(title, year, season, country)
  for (const path of paths) {
    const url = new URL(path, DAHMER_MOVIES_API).href

    try {
      const response = await axios.get<string>(url, {
        headers: REQUEST_HEADERS,
        timeout: REQUEST_TIMEOUT_MS,
        responseType: 'text',
      })

      if (response.data && parseLinks(response.data).length > 0) {
        return { html: response.data, url }
      }
    } catch {
      // Some seasons exist only in either padded or unpadded directories.
    }
  }

  return null
}

async function fetchTmdbDetails(
  tmdbId: string,
  mediaType: 'movie' | 'tv'
): Promise<{ title: string; year: string; country: string } | null> {
  const apiKey = getTmdbApiKey()
  if (!apiKey) {
    console.error('[DahmerMovies] TMDB_API_KEY is not configured')
    return null
  }

  try {
    const response = await axios.get<TmdbDetails>(
      `${TMDB_API_URL}/${mediaType}/${tmdbId}`,
      {
        params: { api_key: apiKey },
        timeout: 8_000,
      }
    )
    const details = response.data

    return {
      title: details.title || details.name || '',
      year: (details.release_date || details.first_air_date || '').slice(0, 4),
      country: details.origin_country?.[0] || '',
    }
  } catch (error) {
    console.error(
      `[DahmerMovies] TMDB lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return null
  }
}

function filterEpisode(
  links: DirectoryLink[],
  season?: number,
  episode?: number
): DirectoryLink[] {
  if (season === undefined || episode === undefined) return links

  const seasonText = String(season).padStart(2, '0')
  const episodeText = String(episode).padStart(2, '0')
  const filtered = links.filter(link => {
    const name = link.text.toLowerCase()
    return (
      name.includes(`s${seasonText}e${episodeText}`) ||
      name.includes(`e${episodeText}`) ||
      new RegExp(`episode[\\s._-]*0?${episode}(?:\\D|$)`, 'i').test(name)
    )
  })

  return filtered
}

function getLanguage(fileName: string, title: string): string {
  if (/\b(HIN|TAM|TEL|Multi|Dual|DUB|Multi-Audio|MULTI)\b/i.test(fileName)) {
    return 'Multi Audio'
  }

  if (
    /^[a-zA-Z0-9\s?!\-:]+$/.test(title) &&
    /\b(Eng|English)\b/i.test(fileName)
  ) {
    return 'English'
  }

  return 'Original'
}

function toProviderLink(
  link: DirectoryLink,
  directoryUrl: string,
  title: string
): ProviderLink | null {
  try {
    const directUrl = new URL(link.href, directoryUrl).href
    const workerUrl = new URL(DAHMER_WORKER_API)
    workerUrl.searchParams.set('u', directUrl)

    const fileFormat =
      link.text.match(/\.(mkv|mp4|m3u8|avi|webm)$/i)?.[1].toUpperCase() ||
      'LINK'
    const resolution =
      link.text.match(/\b(2160p|1080p|720p|4[Kk])\b/)?.[0] || '1080p'
    const language = getLanguage(link.text, title)
    const info = link.text
      .replace(/\.(mkv|mp4|avi|webm|m3u8)$/i, '')
      .replace(/[[\]()._-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    return {
      server: `DahmerMovies | ${language} | ${link.size} | ${fileFormat} | ${info}`,
      url: workerUrl.href,
      isM3U8: fileFormat === 'M3U8',
      quality: resolution.toLowerCase() === '4k' ? '2160p' : resolution,
      subtitles: [],
      headers: {
        'User-Agent': USER_AGENT,
        Referer: `${DAHMER_MOVIES_API}/`,
        Accept: '*/*',
        Range: 'bytes=0-',
      },
    }
  } catch (error) {
    console.warn(
      `[DahmerMovies] Invalid result URL: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return null
  }
}

async function getDahmerMoviesStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  console.log(`[DahmerMovies] Searching for ${mediaType} ${tmdbId}`)

  const details = await fetchTmdbDetails(tmdbId, mediaType)
  if (!details?.title) return []

  const directory = await fetchDirectory(
    details.title,
    details.year,
    season,
    details.country
  )
  if (!directory) {
    console.log(`[DahmerMovies] Directory not found for "${details.title}"`)
    return []
  }

  const links = filterEpisode(parseLinks(directory.html), season, episode)
    .sort(
      (a, b) =>
        Number(/2160p|4k/i.test(b.text)) - Number(/2160p|4k/i.test(a.text))
    )
    .slice(0, 5)
    .map(link => toProviderLink(link, directory.url, details.title))
    .filter((link): link is ProviderLink => link !== null)

  console.log(`[DahmerMovies] Total results found: ${links.length}`)
  return links
}

export const dahmerMoviesProvider: Provider = {
  name: 'DahmerMovies',
  id: 'dahmermovies',
  streamMovie: tmdbId => getDahmerMoviesStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getDahmerMoviesStreams(tmdbId, 'tv', season, episode),
}
