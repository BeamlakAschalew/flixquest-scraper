import type { Provider, ProviderLink, Subtitle } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'
import { decodeSeedPayload } from './_shared/seed-cipher.js'

const API_BASE_URL = 'https://api.wecollege.net'
const MOVY_ORIGIN = 'https://www.movy.bz'
const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
const REQUEST_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'

const REQUEST_HEADERS = {
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: MOVY_ORIGIN,
  Referer: `${MOVY_ORIGIN}/`,
  'User-Agent': USER_AGENT,
}

const MOVY_SERVERS = [
  { slug: 'miami', name: 'Miami' },
  { slug: 'denver', name: 'Denver', sourceFilter: 'dash' },
  { slug: 'seattle', name: 'Seattle' },
  { slug: 'chicago', name: 'Chicago' },
  { slug: 'portland', name: 'Portland' },
  { slug: 'austin', name: 'Austin', sourceFilter: 'English' },
  { slug: 'atlanta', name: 'Atlanta' },
  { slug: 'houston', name: 'Houston' },
  { slug: 'phoenix', name: 'Phoenix' },
  { slug: 'dallas', name: 'Dallas' },
  { slug: 'munich', name: 'Munich', language: 'german' },
  { slug: 'berlin', name: 'Berlin', useGermanTitle: true },
  { slug: 'paris', name: 'Paris' },
  { slug: 'delhi', name: 'Delhi', sourceFilter: 'Hindi' },
  { slug: 'cancun', name: 'Cancun' },
] as const

type MovyServer = (typeof MOVY_SERVERS)[number]

interface MediaDetails {
  title: string
  year: string
  imdbId: string
  totalSeasons: number
  titleGerman: string
}

interface MovySource {
  url?: string
  file?: string
  quality?: string
  label?: string
  title?: string
  type?: string
}

interface MovySubtitle {
  url?: string
  file?: string
  lang?: string
  language?: string
  label?: string
}

interface MovyPayload {
  sources?: MovySource[]
  subtitles?: MovySubtitle[]
  tracks?: MovySubtitle[]
}

function validHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return /^https?:$/.test(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function normalizeQuality(value?: string): string {
  const quality = String(value || '').trim()
  if (/2160|4k|uhd/i.test(quality)) return '2160p'
  if (/1440|2k|qhd/i.test(quality)) return '1440p'
  if (/1080|full\s*hd/i.test(quality)) return '1080p'
  if (/720|\bhd\b/i.test(quality)) return '720p'
  if (/480|\bsd\b/i.test(quality)) return '480p'
  if (/360/i.test(quality)) return '360p'
  return 'Auto'
}

async function fetchMediaDetails(
  tmdbId: string,
  mediaType: 'movie' | 'tv'
): Promise<MediaDetails> {
  const apiKey = process.env.TMDB_API_KEY?.trim()
  if (!apiKey) throw new Error('TMDB_API_KEY is not configured')

  const url = new URL(`${TMDB_BASE_URL}/${mediaType}/${tmdbId}`)
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('append_to_response', 'external_ids,translations')
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`TMDB HTTP ${response.status}`)

  const payload = (await response.json()) as {
    title?: string
    name?: string
    release_date?: string
    first_air_date?: string
    imdb_id?: string
    external_ids?: { imdb_id?: string }
    number_of_seasons?: number
    translations?: {
      translations?: Array<{
        iso_3166_1?: string
        data?: { title?: string; name?: string }
      }>
    }
  }
  const title = mediaType === 'movie' ? payload.title : payload.name
  if (!title) throw new Error('TMDB response did not include a title')

  return {
    title,
    year: (payload.release_date || payload.first_air_date || '').slice(0, 4),
    imdbId: payload.imdb_id || payload.external_ids?.imdb_id || '',
    totalSeasons:
      mediaType === 'tv' && Number.isInteger(payload.number_of_seasons)
        ? Math.max(0, payload.number_of_seasons || 0)
        : 0,
    titleGerman:
      payload.translations?.translations?.find(
        translation => translation.iso_3166_1 === 'DE'
      )?.data?.[mediaType === 'movie' ? 'title' : 'name'] || '',
  }
}

async function fetchSeed(tmdbId: string): Promise<string> {
  const url = new URL(`${API_BASE_URL}/seed`)
  url.searchParams.set('mediaId', tmdbId)
  const response = await fetch(url, {
    headers: REQUEST_HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Movy seed HTTP ${response.status}`)
  const payload = (await response.json()) as { seed?: string }
  if (!payload.seed) throw new Error('Movy returned an empty seed')
  return payload.seed
}

function formatSubtitles(payload: MovyPayload): Subtitle[] {
  const entries = [...(payload.subtitles || []), ...(payload.tracks || [])]
  return Array.from(
    new Map(
      entries.flatMap(entry => {
        const file = validHttpUrl(entry.url || entry.file)
        if (!file) return []
        const label = entry.language || entry.lang || entry.label || 'Unknown'
        return [
          [
            `${file}\n${label}`,
            { file, label, kind: 'captions' } satisfies Subtitle,
          ] as const,
        ]
      })
    ).values()
  )
}

function formatLinks(payload: MovyPayload, serverName: string): ProviderLink[] {
  const subtitles = formatSubtitles(payload)
  return Array.from(
    new Map(
      (payload.sources || []).flatMap((source, index) => {
        const url = validHttpUrl(source.url || source.file)
        if (!url) return []
        const type = source.type?.toLowerCase() || ''
        const link: ProviderLink = {
          server: `Movy | ${serverName} | ${index + 1}`,
          url,
          isM3U8: type.includes('hls') || /\.m3u8(?:$|[?#])/i.test(url),
          ...(type.includes('dash') || /\.mpd(?:$|[?#])/i.test(url)
            ? { isDASH: true }
            : {}),
          quality: normalizeQuality(
            source.quality || source.label || source.title
          ),
          subtitles,
          headers: REQUEST_HEADERS,
          requiresProxy: true,
        }
        return [[url, link] as const]
      })
    ).values()
  ).sort(
    (left, right) =>
      Number(right.quality.match(/\d{3,4}/)?.[0] || 0) -
      Number(left.quality.match(/\d{3,4}/)?.[0] || 0)
  )
}

async function fetchServerLinks(
  server: MovyServer,
  details: MediaDetails,
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season: number,
  episode: number,
  seed: string
): Promise<ProviderLink[]> {
  const url = new URL(`${API_BASE_URL}/${server.slug}/sources`)
  url.searchParams.set('title', encodeURIComponent(details.title))
  url.searchParams.set('mediaType', mediaType)
  url.searchParams.set('year', details.year)
  url.searchParams.set('episodeId', String(episode))
  url.searchParams.set('seasonId', String(season))
  url.searchParams.set('tmdbId', tmdbId)
  url.searchParams.set('imdbId', details.imdbId)
  if ('language' in server) url.searchParams.set('language', server.language)
  if ('useGermanTitle' in server && details.titleGerman) {
    url.searchParams.set('altTitle', encodeURIComponent(details.titleGerman))
  }
  url.searchParams.set('enc', '2')
  url.searchParams.set('seed', seed)

  const response = await fetch(url, {
    headers: REQUEST_HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    const error = new Error(`${server.name} HTTP ${response.status}`)
    ;(error as Error & { status?: number }).status = response.status
    throw error
  }

  const encrypted = (await response.text()).trim()
  if (!encrypted) throw new Error(`${server.name} returned an empty payload`)

  const payload = decodeSeedPayload<MovyPayload>(
    encrypted,
    seed,
    Number(tmdbId)
  )
  const sources = payload.sources || []
  if (!('sourceFilter' in server)) return formatLinks(payload, server.name)

  const filteredSources =
    server.sourceFilter === 'dash'
      ? sources.filter(source => {
          const type = source.type?.toLowerCase() || ''
          const url = source.url || source.file || ''
          return type === 'dash' || /\.mpd(?:$|[?#])/i.test(url)
        })
      : sources.filter(
          source =>
            (source.quality || '').toLowerCase() ===
            server.sourceFilter.toLowerCase()
        )

  return formatLinks(
    {
      ...payload,
      sources:
        server.sourceFilter === 'dash' && filteredSources.length === 0
          ? sources
          : filteredSources,
    },
    server.name
  )
}

async function getMovyStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season = 1,
  episode = 1,
  full = false
): Promise<ProviderLink[]> {
  if (!/^\d+$/.test(tmdbId)) return []
  if (
    mediaType === 'tv' &&
    (!Number.isInteger(season) ||
      season < 1 ||
      !Number.isInteger(episode) ||
      episode < 1)
  ) {
    return []
  }

  try {
    const [details, initialSeed] = await Promise.all([
      fetchMediaDetails(tmdbId, mediaType),
      fetchSeed(tmdbId),
    ])
    let seed = initialSeed
    const allLinks: ProviderLink[] = []

    for (const [index, server] of MOVY_SERVERS.entries()) {
      try {
        let links: ProviderLink[]
        try {
          links = await fetchServerLinks(
            server,
            details,
            tmdbId,
            mediaType,
            season,
            episode,
            seed
          )
        } catch (error) {
          if ((error as Error & { status?: number }).status !== 401) throw error
          seed = await fetchSeed(tmdbId)
          links = await fetchServerLinks(
            server,
            details,
            tmdbId,
            mediaType,
            season,
            episode,
            seed
          )
        }
        if (links.length > 0) {
          if (!full) return links
          allLinks.push(...links)
          continue
        }

        console.warn(
          `[Movy] ${server.name} returned no usable streams${index < MOVY_SERVERS.length - 1 ? '; trying next server' : ''}`
        )
      } catch (error) {
        console.warn(
          `[Movy] ${error instanceof Error ? error.message : `${server.name} failed`}${index < MOVY_SERVERS.length - 1 ? '; trying next server' : ''}`
        )
      }
    }

    return Array.from(
      new Map(
        allLinks.map(link => [`${link.server}|${link.url}`, link] as const)
      ).values()
    )
  } catch (error) {
    console.error(
      `[Movy] ${error instanceof Error ? error.message : 'Provider failed'}`
    )
    return []
  }
}

export const movyProvider: Provider = {
  name: 'Movy (Miami)',
  id: 'movy',
  alias: 'Zeila',
  streamMovie: (tmdbId, options) =>
    getMovyStreams(tmdbId, 'movie', 1, 1, options?.full),
  streamTV: (tmdbId, season, episode, options) =>
    getMovyStreams(tmdbId, 'tv', season, episode, options?.full),
}
