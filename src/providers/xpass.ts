import type { Provider, ProviderLink } from '../types/index.js'

const BASE_URL = 'https://play.xpass.top'
const REQUEST_TIMEOUT_MS = 12_000
const HEADERS = {
  Referer: `${BASE_URL}/`,
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}

interface XPassBackup {
  name?: string
  url?: string
}

interface XPassSource {
  file?: string
  type?: string
}

interface XPassPlaylist {
  sources?: XPassSource[]
}

interface XPassPayload {
  playlist?: XPassPlaylist[]
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok)
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`)
  return response.text()
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok)
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`)
  return response.json() as Promise<T>
}

function hlsVariants(
  playlist: string,
  masterUrl: string
): Array<{ url: string; quality: string }> {
  const variants: Array<{ url: string; quality: string }> = []
  const pattern = /#EXT-X-STREAM-INF:.*?RESOLUTION=(\d+x\d+).*?\n([^\n]+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(playlist))) {
    variants.push({
      quality: `${match[1].split('x')[1]}p`,
      url: new URL(match[2].trim(), masterUrl).href,
    })
  }
  return variants.length ? variants : [{ url: masterUrl, quality: 'auto' }]
}

async function resolveBackup(
  backup: XPassBackup,
  backupIndex: number
): Promise<ProviderLink[]> {
  if (!backup.url) return []
  const endpoint = new URL(backup.url, BASE_URL).href
  const payload = await fetchJson<XPassPayload>(endpoint)
  const sources = payload.playlist?.[0]?.sources || []
  const links: ProviderLink[] = []

  for (const source of sources) {
    if (!source.file || !/^https?:\/\//i.test(source.file)) continue
    const isHls =
      source.type?.toLowerCase().includes('hls') ||
      /\.m3u8(?:$|[?#])/i.test(source.file)
    let candidates = [{ url: source.file, quality: 'auto' }]
    if (isHls) {
      try {
        candidates = hlsVariants(await fetchText(source.file), source.file)
      } catch {
        // Preserve the master playlist when variant expansion fails.
      }
    }
    candidates.forEach((candidate, sourceIndex) => {
      links.push({
        server: `xpass-${backupIndex + 1}-${sourceIndex + 1}`,
        url: candidate.url,
        isM3U8: isHls || /\.m3u8(?:$|[?#])/i.test(candidate.url),
        quality: candidate.quality,
        subtitles: [],
        headers: HEADERS,
        requiresProxy: true,
      })
    })
  }
  return links
}

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  try {
    const pageUrl =
      mediaType === 'tv'
        ? `${BASE_URL}/e/tv/${encodeURIComponent(tmdbId)}/${season}/${episode}`
        : `${BASE_URL}/e/movie/${encodeURIComponent(tmdbId)}`
    const page = await fetchText(pageUrl)
    const encodedBackups = page.match(
      /var backups\s*=\s*(\[.*?\])\s*(?:;|<\/script>)/s
    )?.[1]
    if (!encodedBackups) return []
    const backups = JSON.parse(encodedBackups) as XPassBackup[]
    const results = await Promise.all(
      backups.map((backup, index) =>
        resolveBackup(backup, index).catch(() => [])
      )
    )
    const links = results.flat()
    console.log(`[XPass] Extracted ${links.length} candidate stream(s)`)
    return links
  } catch (error) {
    console.error(
      `[XPass] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const xPassProvider: Provider = {
  name: 'XPass',
  id: 'xpass',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
