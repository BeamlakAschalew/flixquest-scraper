import CryptoJS from 'crypto-js'
import type { Provider, ProviderLink, Subtitle } from '../types/index.js'

const BASE_URL = 'https://api.hlowb.com'
const PACKAGE_NAME = 'com.external.castle'
const CHANNEL = 'IndiaA'
const CLIENT_TYPE = '1'
const LANGUAGE = 'en-US'
const REQUEST_TIMEOUT_MS = 12_000
const API_HEADERS = {
  'User-Agent': 'okhttp/4.9.3',
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  Connection: 'Keep-Alive',
  Referer: BASE_URL,
}
const PLAYBACK_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  Accept: 'video/webm,video/ogg,video/*;q=0.9,*/*;q=0.5',
  'Accept-Language': 'en-US,en;q=0.9',
}

interface CastleEnvelope {
  code?: number
  data?: unknown
}

interface CastleSearchItem {
  id?: string | number
  redirectId?: string | number
  redirectIdStr?: string
  title?: string
  name?: string
}

interface CastleTrack {
  existIndividualVideo?: boolean
  languageId?: string | number
  languageName?: string
  abbreviate?: string
}

interface CastleEpisode {
  id?: string | number
  number?: number
  tracks?: CastleTrack[]
}

interface CastleSeason {
  number?: number
  movieId?: string | number
}

interface CastleVideo {
  url?: string
  resolution?: string
  resolutionDescription?: string
}

interface CastleSubtitle {
  url?: string
  title?: string
  abbreviate?: string
}

interface CastleData {
  rows?: CastleSearchItem[]
  seasons?: CastleSeason[]
  episodes?: CastleEpisode[]
  videoUrl?: string
  videos?: CastleVideo[]
  subtitles?: CastleSubtitle[]
}

async function request(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    headers: { ...API_HEADERS, ...options.headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok)
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`)
  return response
}

async function encryptedBody(response: Response): Promise<string> {
  const text = (await response.text()).trim()
  if (!text) throw new Error('Empty encrypted response')
  try {
    const envelope = JSON.parse(text) as CastleEnvelope
    if (typeof envelope.data === 'string') return envelope.data.trim()
  } catch {
    // Some Castle endpoints return the cipher as plain text.
  }
  return text
}

function decrypt(ciphertext: string, securityKey: string): CastleEnvelope {
  // Castle has served the rotating key as both a hex-like value and Base64.
  // Keep both formats so a server-side rollout does not break extraction.
  const parsers = [CryptoJS.enc.Base64, CryptoJS.enc.Hex]
  for (const parser of parsers) {
    try {
      const combined = parser
        .parse(securityKey)
        .concat(CryptoJS.enc.Utf8.parse('T!BgJB'))
      const words = combined.words.slice(0, 4)
      while (words.length < 4) words.push(0)
      const key = CryptoJS.lib.WordArray.create(words, 16)
      const plaintext = CryptoJS.AES.decrypt(ciphertext, key, {
        iv: key,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      }).toString(CryptoJS.enc.Utf8)
      if (plaintext) return JSON.parse(plaintext) as CastleEnvelope
    } catch {
      // Try the alternate key encoding.
    }
  }
  throw new Error('Castle decryption returned no data')
}

function dataBlock(payload: CastleEnvelope): CastleData {
  return payload.data && typeof payload.data === 'object'
    ? (payload.data as CastleData)
    : (payload as CastleData)
}

async function getSecurityKey(): Promise<string> {
  const url = `${BASE_URL}/v0.1/system/getSecurityKey/1?channel=${CHANNEL}&clientType=${CLIENT_TYPE}&lang=${LANGUAGE}`
  const payload = (await (await request(url)).json()) as CastleEnvelope
  if (payload.code !== 200 || typeof payload.data !== 'string')
    throw new Error('Castle security-key request failed')
  return payload.data
}

async function getMetadata(
  tmdbId: string,
  mediaType: 'movie' | 'tv'
): Promise<{ title: string; year?: number }> {
  const apiKey = process.env.TMDB_API_KEY?.trim()
  if (!apiKey) throw new Error('TMDB_API_KEY is not configured')
  const url = `https://api.themoviedb.org/3/${mediaType}/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(apiKey)}`
  const payload = (await (await request(url)).json()) as {
    title?: string
    name?: string
    release_date?: string
    first_air_date?: string
  }
  const title = mediaType === 'tv' ? payload.name : payload.title
  const date =
    mediaType === 'tv' ? payload.first_air_date : payload.release_date
  if (!title) throw new Error('TMDB returned no title')
  return { title, year: date ? Number(date.slice(0, 4)) : undefined }
}

async function getEncryptedJson(
  url: string,
  securityKey: string,
  options: RequestInit = {}
): Promise<CastleEnvelope> {
  return decrypt(await encryptedBody(await request(url, options)), securityKey)
}

async function findMovieId(
  securityKey: string,
  title: string,
  year?: number
): Promise<string> {
  const params = new URLSearchParams({
    channel: CHANNEL,
    clientType: CLIENT_TYPE,
    keyword: year ? `${title} ${year}` : title,
    lang: LANGUAGE,
    mode: '1',
    packageName: PACKAGE_NAME,
    page: '1',
    size: '30',
  })
  const payload = await getEncryptedJson(
    `${BASE_URL}/film-api/v1.1.0/movie/searchByKeyword?${params}`,
    securityKey
  )
  const rows = dataBlock(payload).rows || []
  const normalized = title.toLowerCase()
  const match =
    rows.find(item => {
      const candidate = (item.title || item.name || '').toLowerCase()
      return candidate.includes(normalized) || normalized.includes(candidate)
    }) || rows[0]
  const id = match?.id || match?.redirectId || match?.redirectIdStr
  if (!id) throw new Error('Castle search returned no usable ID')
  return id.toString()
}

async function getDetails(
  securityKey: string,
  movieId: string
): Promise<CastleEnvelope> {
  return getEncryptedJson(
    `${BASE_URL}/film-api/v1.9.9/movie?channel=${CHANNEL}&clientType=${CLIENT_TYPE}&lang=${LANGUAGE}&movieId=${movieId}&packageName=${PACKAGE_NAME}`,
    securityKey
  )
}

async function getVideo(
  securityKey: string,
  movieId: string,
  episodeId: string,
  languageId?: string | number
): Promise<CastleEnvelope> {
  const url = `${BASE_URL}/film-api/v2.0.1/movie/getVideo2?clientType=${CLIENT_TYPE}&packageName=${PACKAGE_NAME}&channel=${CHANNEL}&lang=${LANGUAGE}`
  const body: Record<string, string> = {
    mode: '1',
    appMarket: 'GuanWang',
    clientType: CLIENT_TYPE,
    woolUser: 'false',
    apkSignKey: 'ED0955EB04E67A1D9F3305B95454FED485261475',
    androidVersion: '13',
    movieId,
    episodeId,
    isNewUser: 'true',
    resolution: '2',
    packageName: PACKAGE_NAME,
  }
  if (languageId !== undefined) body.languageId = languageId.toString()
  return getEncryptedJson(url, securityKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function streamLinks(
  payload: CastleEnvelope,
  language = 'Shared'
): ProviderLink[] {
  const data = dataBlock(payload)
  if (!data.videoUrl) return []
  const subtitles: Subtitle[] = (data.subtitles || []).flatMap(item =>
    item.url
      ? [
          {
            file: item.url,
            label: item.title || item.abbreviate || 'Unknown',
            kind: 'captions',
          },
        ]
      : []
  )
  const videos = data.videos?.length
    ? data.videos
    : [{ url: data.videoUrl, resolution: '720p' }]
  return videos.flatMap((video, index) => {
    const url = video.url || data.videoUrl
    if (!url || !/^https?:\/\//i.test(url)) return []
    const quality = (
      video.resolutionDescription ||
      video.resolution ||
      '720p'
    ).replace(/^(SD|HD|FHD)\s+/i, '')
    return [
      {
        server: `castle-${language.toLowerCase().replace(/\W+/g, '-')}-${index + 1}`,
        url,
        isM3U8: /\.m3u8(?:$|[?#])/i.test(url),
        quality,
        subtitles,
        headers: PLAYBACK_HEADERS,
      },
    ]
  })
}

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  try {
    const metadata = await getMetadata(tmdbId, mediaType)
    const securityKey = await getSecurityKey()
    const rootId = await findMovieId(securityKey, metadata.title, metadata.year)
    let movieId = rootId
    let details = await getDetails(securityKey, movieId)
    if (mediaType === 'tv') {
      const seasonItem = dataBlock(details).seasons?.find(
        item => item.number === season
      )
      if (seasonItem?.movieId && seasonItem.movieId.toString() !== movieId) {
        movieId = seasonItem.movieId.toString()
        details = await getDetails(securityKey, movieId)
      }
    }
    const episodeItem =
      mediaType === 'tv'
        ? dataBlock(details).episodes?.find(item => item.number === episode)
        : dataBlock(details).episodes?.[0]
    if (!episodeItem?.id) return []

    const tracks = episodeItem.tracks || []
    const results: ProviderLink[] = []
    for (const track of tracks) {
      if (!track.existIndividualVideo || track.languageId === undefined)
        continue
      try {
        results.push(
          ...streamLinks(
            await getVideo(
              securityKey,
              movieId,
              episodeItem.id.toString(),
              track.languageId
            ),
            track.languageName || track.abbreviate || 'Unknown'
          )
        )
      } catch {
        // Try the other available audio tracks.
      }
    }
    if (!results.length) {
      results.push(
        ...streamLinks(
          await getVideo(securityKey, movieId, episodeItem.id.toString())
        )
      )
    }
    console.log(`[Castle] Extracted ${results.length} candidate stream(s)`)
    return results
  } catch (error) {
    console.error(
      `[Castle] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const castleProvider: Provider = {
  name: 'Castle',
  id: 'castle',
  alias: 'Dogali',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
