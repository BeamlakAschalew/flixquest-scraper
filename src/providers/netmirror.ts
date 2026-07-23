import type { Provider, ProviderLink, Subtitle } from '../types/index.js'

const BASE_URL = 'https://net27.cc'
const REQUEST_TIMEOUT_MS = 12_000
const HEADERS = {
  Accept: 'application/json, text/plain, */*',
  Referer: `${BASE_URL}/`,
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0',
}

interface NetMirrorResponse {
  ok?: boolean
  mp4?: string
  mode?: string
  streams?: Array<{ url?: string; resolution?: string | number }>
  subtitles?: Array<{
    url?: string
    lang?: string
    label?: string
    name?: string
  }>
  captions?: Array<{
    url?: string
    lang?: string
    label?: string
    name?: string
  }>
}

function absoluteUrl(value?: string): string | undefined {
  if (!value) return undefined
  try {
    return new URL(value, BASE_URL).href
  } catch {
    return undefined
  }
}

function mapSubtitles(payload: NetMirrorResponse): Subtitle[] {
  return (payload.captions || payload.subtitles || []).flatMap(item => {
    const file = absoluteUrl(item.url)
    if (!file) return []
    return [
      {
        file,
        label: item.label || item.name || item.lang || 'Unknown',
        kind: 'captions',
      },
    ]
  })
}

function playbackUrl(value: string, useProxy: boolean): string {
  if (!useProxy) return value
  const url = new URL(`${BASE_URL}/api/proxy/video`)
  url.searchParams.set('url', value)
  return url.href
}

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  try {
    const url = new URL(
      `${BASE_URL}/api/embed-tmdb/${encodeURIComponent(tmdbId)}`
    )
    if (mediaType === 'tv') {
      url.searchParams.set('type', 'tv')
      url.searchParams.set('s', String(season))
      url.searchParams.set('e', String(episode))
    }

    const response = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const payload = (await response.json()) as NetMirrorResponse
    if (payload.ok !== true) return []

    const subtitles = mapSubtitles(payload)
    const candidates = new Map<string, string>()
    const useProxy = payload.mode === 'proxy'
    for (const stream of payload.streams || []) {
      const streamUrl = absoluteUrl(stream.url)
      if (!streamUrl) continue
      const quality = String(stream.resolution || 'auto').replace(
        /^(\d+)$/,
        '$1p'
      )
      candidates.set(playbackUrl(streamUrl, useProxy), quality)
    }
    const mp4 = absoluteUrl(payload.mp4)
    if (mp4) candidates.set(playbackUrl(mp4, useProxy), 'auto')

    const links = Array.from(candidates, ([streamUrl, quality], index) => ({
      server: `netmirror-${index + 1}`,
      url: streamUrl,
      isM3U8: /\.m3u8(?:$|[?#])/i.test(streamUrl),
      quality: quality.toLowerCase(),
      subtitles,
      headers: HEADERS,
    }))
    console.log(`[NetMirror] Extracted ${links.length} candidate stream(s)`)
    return links
  } catch (error) {
    console.error(
      `[NetMirror] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const netMirrorProvider: Provider = {
  name: 'NetMirror',
  id: 'netmirror',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
