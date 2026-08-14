import { createDecipheriv } from 'node:crypto'
import type { Provider, ProviderLink } from '../types/index.js'

const ORIGIN = 'https://peachify.top'
const REQUEST_TIMEOUT_MS = 10_000
const AES_KEY = Buffer.from(
  'a8f2a1b5e9c470814f6b2c3a5d8e7f9c1a2b3c4d5e3f7a8b8cad1e2d0a4d5c5d',
  'hex'
)
const USER_AGENTS = [
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
]
const SERVERS = [
  { label: 'Iron', base: 'https://uwu.eat-peach.sbs', path: 'moviebox' },
  { label: 'Wolf', base: 'https://usa.eat-peach.sbs', path: 'air' },
  { label: 'Spider', base: 'https://usa.eat-peach.sbs', path: 'holly' },
  { label: 'Multi', base: 'https://usa.eat-peach.sbs', path: 'multi' },
  { label: 'Dark', base: 'https://uwu.eat-peach.sbs', path: 'net' },
]

interface PeachSource {
  url?: string
  src?: string
  file?: string
  stream?: string
  streamUrl?: string
  dub?: string
  audio?: string
  language?: string
  name?: string
  quality?: string
  resolution?: string
  type?: string
  headers?: Record<string, string>
}

interface PeachPayload {
  isEncrypted?: boolean
  data?: string
  sources?: PeachSource[]
}

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function decryptPayload(token: string): PeachPayload {
  const parts = token.split('.')
  if (parts.length < 3) throw new Error('Invalid encrypted response')
  const iv = decodeBase64Url(parts[0])
  const combined = Buffer.concat([
    decodeBase64Url(parts[1]),
    decodeBase64Url(parts[2]),
  ])
  const ciphertext = combined.subarray(0, -16)
  const authTag = combined.subarray(-16)
  const decipher = createDecipheriv('aes-256-gcm', AES_KEY, iv)
  decipher.setAuthTag(authTag)
  return JSON.parse(
    Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      'utf8'
    )
  ) as PeachPayload
}

function qualityFromSource(source: PeachSource): string {
  const label = source.quality || source.resolution || ''
  const match = label.match(/2160|1080|720|480|360/i)
  return match ? `${match[0]}p` : label || 'HD'
}

async function queryServer(
  server: (typeof SERVERS)[number],
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  const suffix = mediaType === 'tv' ? `/${season}/${episode}` : ''
  const url = `${server.base}/${server.path}/${mediaType}/${encodeURIComponent(tmdbId)}${suffix}`
  const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Origin: ORIGIN,
      Referer: `${ORIGIN}/`,
      'User-Agent': userAgent,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) return []

  const envelope = (await response.json()) as PeachPayload
  const payload =
    envelope.isEncrypted && envelope.data
      ? decryptPayload(envelope.data)
      : envelope
  return (payload.sources || []).flatMap((source, index) => {
    const streamUrl =
      source.url ||
      source.src ||
      source.file ||
      source.stream ||
      source.streamUrl
    if (!streamUrl || !/^https?:\/\//i.test(streamUrl)) return []
    return [
      {
        server: `peachify-${server.label.toLowerCase()}-${index + 1}`,
        url: streamUrl,
        isM3U8: source.type === 'hls' || /\.m3u8(?:$|[?#])/i.test(streamUrl),
        quality: qualityFromSource(source),
        subtitles: [],
        requiresProxy: true,
        headers: {
          Origin: ORIGIN,
          Referer: `${ORIGIN}/`,
          'User-Agent': userAgent,
          ...source.headers,
        },
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
  const results = await Promise.all(
    SERVERS.map(server =>
      queryServer(server, tmdbId, mediaType, season, episode).catch(() => [])
    )
  )
  const links = results.flat()
  console.log(`[Peachify] Extracted ${links.length} candidate stream(s)`)
  return links
}

export const peachifyProvider: Provider = {
  name: 'Peachify',
  id: 'peachify',
  alias: 'Harar',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
