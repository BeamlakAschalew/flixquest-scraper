import { gunzipSync } from 'node:zlib'
import { withForcedForwardProxy } from '../forward-proxy.js'
import type { Subtitle } from '../../types/index.js'
import { languageFlagUrl } from './flags.js'
import { defaultOutputFormat, subtitleFilePath } from './paths.js'
import { createSubtitleFileToken, type SubtitleFileToken } from './tokens.js'
import { decodeSubtitleBytes } from './vtt.js'
import type { SubtitleCatalogEntry, SubtitleProvider, SubtitleQuery } from './types.js'

const BASE_URL = 'https://rest.opensubtitles.org/search'
const TIMEOUT_MS = 20_000
const FILE_TIMEOUT_MS = 30_000
const MAX_FILE_BYTES = 8 * 1024 * 1024

interface OpenSubtitleResult {
  IDSubtitleFile?: string
  SubFileName?: string
  SubLanguageID?: string
  ISO639?: string
  LanguageName?: string
  SubFormat?: string
  SubEncoding?: string
  SubHearingImpaired?: string
  SubAutoTranslation?: string
  MovieName?: string
  MovieReleaseName?: string
  SubDownloadLink?: string
}

function queryUrl(query: SubtitleQuery): string | undefined {
  const imdbId = query.imdbId?.replace(/^tt/i, '')
  if (!imdbId) return undefined
  const parts = query.season !== undefined && query.episode !== undefined
    ? [`episode-${query.episode}`, `imdbid-${imdbId}`, `season-${query.season}`]
    : [`imdbid-${imdbId}`]
  return `${BASE_URL}/${parts.join('/')}`
}

function languageCode(item: OpenSubtitleResult): string {
  return (item.ISO639 || item.SubLanguageID || '').trim().toLowerCase()
}

function isUsable(item: OpenSubtitleResult): item is OpenSubtitleResult & { SubDownloadLink: string } {
  return typeof item.SubDownloadLink === 'string' && /^https?:\/\//i.test(item.SubDownloadLink) &&
    (item.SubFormat || '').toLowerCase() === 'srt'
}

function toCatalog(results: OpenSubtitleResult[]): SubtitleCatalogEntry[] {
  const format = defaultOutputFormat()
  return results.filter(isUsable).map((item, index) => {
    const language = languageCode(item)
    const id = String(item.IDSubtitleFile || index)
    const token = createSubtitleFileToken({ url: item.SubDownloadLink, encoding: item.SubEncoding, language })
    return {
      id: `opensubtitles-${id}`,
      url: subtitleFilePath('opensubtitles', id, { token }),
      display: item.LanguageName || language || 'Unknown',
      language,
      format,
      encoding: 'UTF-8',
      isHearingImpaired: item.SubHearingImpaired === '1',
      source: 'opensubtitles',
      flagUrl: languageFlagUrl(language),
      media: item.MovieName || '',
      release: item.MovieReleaseName || item.SubFileName,
      machineTranslated: item.SubAutoTranslation === '1',
    }
  })
}

async function catalog(query: SubtitleQuery): Promise<SubtitleCatalogEntry[]> {
  const url = queryUrl(query)
  if (!url) return []
  try {
    const response = await withForcedForwardProxy(() =>
      fetch(url, {
        headers: {
          accept: 'application/json',
          'x-user-agent': 'FlixQuestScraper v2.0',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    )
    if (!response.ok) return []
    const payload = await response.json() as unknown
    return Array.isArray(payload) ? toCatalog(payload as OpenSubtitleResult[]) : []
  } catch (error) {
    console.warn(`[OpenSubtitles] ${error instanceof Error ? error.message : 'Unknown error'}`)
    return []
  }
}

export const opensubtitlesProvider: SubtitleProvider = {
  id: 'opensubtitles',
  name: 'OpenSubtitles',
  catalog,
  async search(query: SubtitleQuery): Promise<Subtitle[]> {
    return (await catalog(query)).map(entry => ({ file: entry.url, label: entry.display, kind: entry.isHearingImpaired ? 'captions' : 'subtitles' }))
  },
}

export async function fetchOpenSubtitlesFile(token: SubtitleFileToken): Promise<string> {
  const response = await withForcedForwardProxy(() =>
    fetch(token.url, {
      headers: {
        accept: '*/*',
        'user-agent': 'Mozilla/5.0',
        'x-user-agent': 'FlixQuestScraper v2.0',
      },
      signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
    })
  )
  if (!response.ok) throw new Error(`Upstream responded with HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FILE_BYTES) throw new Error('Invalid OpenSubtitles file size')
  let decoded: Uint8Array
  try { decoded = gunzipSync(bytes) } catch { decoded = bytes }
  const text = decodeSubtitleBytes(decoded, token.encoding, token.language)
  if (!text.includes('-->')) throw new Error('Upstream returned a subtitle file with no cues')
  return text
}
