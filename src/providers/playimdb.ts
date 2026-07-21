import type { Provider, ProviderLink, Subtitle } from '../types/index.js'

const API_URL = 'https://streamdata.vaplayer.ru/api.php'
const REQUEST_TIMEOUT_MS = 12_000
const HEADERS = {
  Origin: 'https://nextgencloudfabric.com',
  Referer: 'https://nextgencloudfabric.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}

interface PlayImdbSubtitle {
  code?: string
  file?: string
  lang?: string
  label?: string
  url?: string
}

interface PlayImdbResponse {
  status?: string
  status_code?: number
  data?: {
    default_subs?: PlayImdbSubtitle[]
    file_name?: string
    stream_urls?: unknown
  }
  default_subs?: PlayImdbSubtitle[]
}

function collectUrls(value: unknown): string[] {
  if (typeof value === 'string')
    return /^https?:\/\//i.test(value) ? [value] : []
  if (Array.isArray(value)) return value.flatMap(collectUrls)
  if (!value || typeof value !== 'object') return []
  return Object.values(value as Record<string, unknown>).flatMap(collectUrls)
}

function qualityFromName(name = ''): string {
  return name.match(/(?:2160|1080|720|480|360)p?/i)?.[0].toLowerCase() || 'auto'
}

function mapSubtitles(items: PlayImdbSubtitle[] = []): Subtitle[] {
  return items.flatMap(item => {
    const file = item.url || item.file
    if (!file || !/^https?:\/\//i.test(file)) return []
    return [
      {
        file,
        label: item.label || item.lang || item.code || 'Unknown',
        kind: 'captions',
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
    const url = new URL(API_URL)
    url.searchParams.set('id', tmdbId)
    url.searchParams.set('type', mediaType)
    if (mediaType === 'tv') {
      url.searchParams.set('season', String(season))
      url.searchParams.set('episode', String(episode))
    }

    const response = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const payload = (await response.json()) as PlayImdbResponse
    if (
      payload.status_code !== 200 &&
      payload.status?.toLowerCase() !== 'success'
    ) {
      console.log(
        `[PlayIMDb] Upstream status: ${payload.status_code ?? payload.status ?? 'unknown'}`
      )
      return []
    }

    const fileName = payload.data?.file_name || ''
    const subtitles = mapSubtitles(
      payload.data?.default_subs || payload.default_subs
    )
    const streams = Array.from(
      new Set(collectUrls(payload.data?.stream_urls))
    ).map((streamUrl, index) => ({
      server: `playimdb-${index + 1}`,
      url: streamUrl,
      isM3U8: /\.m3u8(?:$|[?#])/i.test(streamUrl),
      quality: qualityFromName(fileName),
      subtitles,
      headers: HEADERS,
    }))
    console.log(`[PlayIMDb] Extracted ${streams.length} candidate stream(s)`)
    return streams
  } catch (error) {
    console.error(
      `[PlayIMDb] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const playImdbProvider: Provider = {
  name: 'PlayIMDb',
  id: 'playimdb',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
