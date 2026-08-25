import axios from 'axios'
import { load } from 'cheerio'
import type { Provider, ProviderLink, Subtitle } from '../types/index.js'
import {
  generateMovieMedia,
  generateShowMedia,
  type MovieMedia,
  type ShowMedia,
} from '../utils/tmdb.js'

const SHOWBOX_BASE_URL = 'https://www.showbox.media'
const FEBBOX_BASE_URL = 'https://www.febbox.com'
const REQUEST_TIMEOUT_MS = 30_000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
const PUBLIC_HEADERS = {
  Accept: 'text/html,application/json,*/*',
  'User-Agent': USER_AGENT,
}
const PLAYBACK_HEADERS = {
  Accept: '*/*',
  Referer: `${FEBBOX_BASE_URL}/`,
  'User-Agent': USER_AGENT,
}
const VIDEO_EXTENSION = /\.(?:avi|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|ts|webm)$/i

let cookiePool: string[] = []
let currentCookieIndex = 0

interface QualityInfo {
  quality: string
  priority: number
}

interface ShowBoxShareResponse {
  code?: number
  msg?: string
  data?: {
    link?: string
  }
}

interface FebBoxFile {
  fid: number
  file_name: string
  is_dir: number
}

interface FebBoxListResponse {
  code?: number
  msg?: string
  data?: {
    file_list?: FebBoxFile[]
  }
}

interface FebBoxPlayerSource {
  file?: string
  label?: string
  type?: string
}

interface RenditionDetails {
  codecs: string[]
  estimatedSize?: string
}

interface CookieQuotaResult {
  ok: boolean
  remainingMB: number
  cookie: string
}

type MediaMetadata = MovieMedia | ShowMedia

function parseQualityFromLabel(label: string | null | undefined): QualityInfo {
  if (!label) return { quality: 'ORG', priority: 0 }

  const value = String(label).toLowerCase()
  if (
    value.includes('2160p') ||
    value.includes('2160') ||
    value.includes('4k') ||
    value.includes('uhd')
  ) {
    return { quality: '2160p', priority: 5 }
  }
  if (value.includes('1080p') || value.includes('1080')) {
    return { quality: '1080p', priority: 4 }
  }
  if (value.includes('720p') || value.includes('720')) {
    return { quality: '720p', priority: 3 }
  }
  if (value.includes('480p') || value.includes('480')) {
    return { quality: '480p', priority: 2 }
  }
  if (value.includes('360p') || value.includes('360')) {
    return { quality: '360p', priority: 1 }
  }
  if (value.includes('hd')) return { quality: '720p', priority: 3 }
  if (value.includes('sd')) return { quality: '480p', priority: 2 }
  return { quality: 'ORG', priority: 0 }
}

function parseHlsAttribute(line: string, name: string): string | undefined {
  const value = line.match(new RegExp(`(?:^|[:,])${name}=("[^"]*"|[^,]*)`))?.[1]
  return value?.replace(/^"|"$/g, '')
}

function codecDetailsFromVariant(line: string): string[] {
  const codecs = parseHlsAttribute(line, 'CODECS')?.toLowerCase() || ''
  const videoRange = parseHlsAttribute(line, 'VIDEO-RANGE')?.toUpperCase() || ''
  const details = new Set<string>()

  if (/(?:dvhe|dvh1)/.test(codecs)) details.add('DV')
  if (videoRange === 'PQ' || videoRange === 'HLG') details.add('HDR')
  if (/(?:hev1|hvc1|dvhe|dvh1)/.test(codecs)) {
    details.add('HEVC')
  } else if (/(?:avc1|avc3)/.test(codecs)) {
    details.add('H.264')
  } else if (/(?:av01)/.test(codecs)) {
    details.add('AV1')
  } else if (/(?:vp09|vp9)/.test(codecs)) {
    details.add('VP9')
  }

  if (codecs.includes('ec-3')) {
    details.add('EAC3')
  } else if (codecs.includes('ac-3')) {
    details.add('AC3')
  } else if (codecs.includes('mp4a')) {
    details.add('AAC')
  } else if (codecs.includes('opus')) {
    details.add('Opus')
  }
  return Array.from(details)
}

function formatBytes(bytes: number): string | undefined {
  if (!Number.isFinite(bytes) || bytes <= 0) return undefined
  const gibibytes = bytes / 1024 ** 3
  if (gibibytes >= 1) return `${gibibytes.toFixed(2)} GB`
  return `${Math.round(bytes / 1024 ** 2)} MB`
}

function buildQualityString(
  quality: string,
  codecs: string[],
  estimatedSize?: string
): string {
  const parts = [quality]
  if (codecs.length) parts.push(codecs.join(' | '))
  if (estimatedSize) parts.push(`[~${estimatedSize}]`)
  return parts.join(' ')
}

function firstVariant(master: string): {
  info: string
  url: string
} | null {
  const lines = master.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].startsWith('#EXT-X-STREAM-INF:')) continue
    const url = lines
      .slice(index + 1)
      .find(line => line && !line.startsWith('#'))
    if (url) return { info: lines[index], url }
  }
  return null
}

function selectedAudioSize(master: string, variantInfo: string): number {
  const audioGroup = parseHlsAttribute(variantInfo, 'AUDIO')
  if (!audioGroup) return 0

  const audioLine = master.split(/\r?\n/).find(line => {
    return (
      line.startsWith('#EXT-X-MEDIA:') &&
      parseHlsAttribute(line, 'TYPE') === 'AUDIO' &&
      parseHlsAttribute(line, 'GROUP-ID') === audioGroup &&
      parseHlsAttribute(line, 'DEFAULT') === 'YES'
    )
  })
  const audioUrl = audioLine && parseHlsAttribute(audioLine, 'URI')
  if (!audioUrl) return 0

  try {
    return Number(new URL(audioUrl).searchParams.get('size')) || 0
  } catch {
    return 0
  }
}

function estimateVideoBytes(
  mediaPlaylist: string,
  fallbackBandwidth: number
): number {
  const lines = mediaPlaylist.split(/\r?\n/)
  let duration = 0
  let totalDuration = 0
  let estimatedBytes = 0

  for (const line of lines) {
    const durationMatch = line.match(/^#EXTINF:([\d.]+)/)
    if (durationMatch?.[1]) {
      duration = Number(durationMatch[1])
      totalDuration += duration
      continue
    }

    const bitrateMatch = line.match(/^#EXT-X-BITRATE:(\d+)/)
    if (bitrateMatch?.[1] && duration > 0) {
      estimatedBytes += (duration * Number(bitrateMatch[1]) * 1000) / 8
      continue
    }

    if (line && !line.startsWith('#')) duration = 0
  }

  if (estimatedBytes > 0) return estimatedBytes
  return fallbackBandwidth > 0 ? (totalDuration * fallbackBandwidth) / 8 : 0
}

async function inspectRendition(url: string): Promise<RenditionDetails> {
  try {
    const masterResponse = await axios.get<string>(url, {
      headers: PLAYBACK_HEADERS,
      timeout: REQUEST_TIMEOUT_MS,
    })
    const master = String(masterResponse.data)
    const variant = firstVariant(master)
    if (!variant) return { codecs: [] }

    const mediaUrl = new URL(variant.url, url).href
    const mediaResponse = await axios.get<string>(mediaUrl, {
      headers: PLAYBACK_HEADERS,
      timeout: REQUEST_TIMEOUT_MS,
    })
    const fallbackBandwidth =
      Number(parseHlsAttribute(variant.info, 'AVERAGE-BANDWIDTH')) ||
      Number(parseHlsAttribute(variant.info, 'BANDWIDTH')) ||
      0
    const videoBytes = estimateVideoBytes(
      String(mediaResponse.data),
      fallbackBandwidth
    )
    const totalBytes = videoBytes + selectedAudioSize(master, variant.info)
    return {
      codecs: codecDetailsFromVariant(variant.info),
      estimatedSize: formatBytes(totalBytes),
    }
  } catch {
    return { codecs: [] }
  }
}

function normalizeTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function normalizeCookieHeader(cookie: string): string {
  return /(?:^|;\s*)ui=/.test(cookie) ? cookie : `ui=${cookie}`
}

function loadEnvironmentCookies(): void {
  if (cookiePool.length) return

  const configured =
    process.env.SHOWBOX_COOKIES || process.env.FEBBOX_COOKIE || ''
  cookiePool = configured
    .split(',')
    .map(cookie => cookie.trim())
    .filter(Boolean)

  if (cookiePool.length) {
    console.log(
      `[ShowBox] Loaded ${cookiePool.length} cookie(s) from environment`
    )
  }
}

async function checkCookieQuota(cookie: string): Promise<CookieQuotaResult> {
  try {
    const response = await axios.get(`${FEBBOX_BASE_URL}/console/user_cards`, {
      headers: {
        ...PUBLIC_HEADERS,
        Cookie: normalizeCookieHeader(cookie),
      },
      timeout: 8_000,
      validateStatus: () => true,
    })
    const flow = response.data?.data?.flow
    if (response.status === 200 && flow) {
      const remainingMB =
        (Number(flow.traffic_limit_mb) || 0) -
        (Number(flow.traffic_usage_mb) || 0)
      console.log(`[ShowBox] Cookie quota check: ${remainingMB} MB remaining`)
      return { ok: true, remainingMB, cookie }
    }
  } catch (error) {
    console.warn(
      `[ShowBox] Quota check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
  return { ok: false, remainingMB: -1, cookie }
}

async function selectBestCookie(): Promise<string | null> {
  loadEnvironmentCookies()

  if (!cookiePool.length) {
    console.warn(
      '[ShowBox] No cookies configured - FebBox requires a ui cookie'
    )
    return null
  }
  if (cookiePool.length === 1) {
    console.log('[ShowBox] Using single configured cookie')
    return cookiePool[0]
  }

  console.log(`[ShowBox] Checking quota for ${cookiePool.length} cookies...`)
  const results = await Promise.all(cookiePool.map(checkCookieQuota))
  const valid = results
    .filter(result => result.ok && result.remainingMB > 0)
    .sort((left, right) => right.remainingMB - left.remainingMB)
  if (valid[0]) {
    console.log(
      `[ShowBox] Selected cookie with ${valid[0].remainingMB} MB remaining`
    )
    return valid[0].cookie
  }

  const cookie = cookiePool[currentCookieIndex % cookiePool.length]
  currentCookieIndex++
  console.log('[ShowBox] Quota checks failed, using round-robin selection')
  return cookie
}

async function getMetadata(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<MediaMetadata> {
  if (mediaType === 'movie') return generateMovieMedia(tmdbId)
  if (season === undefined || episode === undefined) {
    throw new Error('TV shows require season and episode numbers')
  }
  return generateShowMedia(tmdbId, season, episode)
}

async function findDetailPath(
  metadata: MediaMetadata,
  mediaType: 'movie' | 'tv'
): Promise<string> {
  const response = await axios.get(`${SHOWBOX_BASE_URL}/search`, {
    params: { keyword: metadata.title },
    headers: PUBLIC_HEADERS,
    timeout: REQUEST_TIMEOUT_MS,
  })
  const $ = load(String(response.data))
  const expectedPrefix = mediaType === 'movie' ? '/movie/' : '/tv/'
  const expectedTitle = normalizeTitle(metadata.title)
  const candidates: Array<{
    path: string
    score: number
    title: string
  }> = []

  $('.flw-item').each((_index, element) => {
    const card = $(element)
    const anchor = card
      .find(`a[href^="${expectedPrefix}"]`)
      .filter((_anchorIndex, item) => Boolean($(item).attr('title')))
      .first()
    const path = anchor.attr('href')
    const title =
      anchor.attr('title') || card.find('.film-name').text().trim() || ''
    if (!path || !title) return

    const normalized = normalizeTitle(title)
    const year = Number(path.match(/-(\d{4})(?:\/)?$/)?.[1])
    let score = 0
    if (normalized === expectedTitle) score += 100
    else if (
      normalized.includes(expectedTitle) ||
      expectedTitle.includes(normalized)
    ) {
      score += 20
    }
    if (year === metadata.releaseYear) score += 25
    else if (Math.abs(year - metadata.releaseYear) === 1) score += 5
    candidates.push({ path, score, title })
  })

  candidates.sort((left, right) => right.score - left.score)
  const best = candidates[0]
  if (!best || best.score < 100) {
    throw new Error(
      `No matching ShowBox ${mediaType} result for "${metadata.title}" (${metadata.releaseYear})`
    )
  }
  console.log(`[ShowBox] Matched ShowBox title: ${best.title}`)
  return best.path
}

function parseShareRequest(
  html: string,
  mediaType: 'movie' | 'tv'
): { id: string; type: number } {
  const expectedType = mediaType === 'movie' ? 1 : 2
  const shareBlockPattern =
    /\/index\/share_link[\s\S]{0,500}?data\s*:\s*\{([\s\S]{0,250}?)\}/g

  for (const match of html.matchAll(shareBlockPattern)) {
    const block = match[1] || ''
    const id = block.match(/['"]?id['"]?\s*:\s*['"]?(\d+)/)?.[1]
    const type = Number(block.match(/['"]?type['"]?\s*:\s*['"]?(\d+)/)?.[1])
    if (id && type === expectedType) return { id, type }
  }
  throw new Error('ShowBox detail page did not expose a FebBox share ID')
}

async function getShareKey(
  detailPath: string,
  mediaType: 'movie' | 'tv'
): Promise<string> {
  const detailUrl = new URL(detailPath, SHOWBOX_BASE_URL).href
  const detailResponse = await axios.get(detailUrl, {
    headers: PUBLIC_HEADERS,
    timeout: REQUEST_TIMEOUT_MS,
  })
  const request = parseShareRequest(String(detailResponse.data), mediaType)
  const shareResponse = await axios.get<ShowBoxShareResponse>(
    `${SHOWBOX_BASE_URL}/index/share_link`,
    {
      params: request,
      headers: { ...PUBLIC_HEADERS, Referer: detailUrl },
      timeout: REQUEST_TIMEOUT_MS,
    }
  )
  const shareUrl = shareResponse.data?.data?.link
  const shareKey = shareUrl?.match(/\/share\/([^/?#]+)/)?.[1]
  if (shareResponse.data?.code !== 1 || !shareKey) {
    throw new Error(
      `ShowBox share lookup failed: ${shareResponse.data?.msg || 'missing FebBox share URL'}`
    )
  }
  return shareKey
}

async function listShareFiles(
  shareKey: string,
  parentId = 0
): Promise<FebBoxFile[]> {
  const response = await axios.get<FebBoxListResponse>(
    `${FEBBOX_BASE_URL}/file/file_share_list`,
    {
      params: {
        share_key: shareKey,
        pwd: '',
        parent_id: parentId,
      },
      headers: {
        ...PUBLIC_HEADERS,
        Referer: `${FEBBOX_BASE_URL}/share/${shareKey}`,
      },
      timeout: REQUEST_TIMEOUT_MS,
    }
  )
  if (response.data?.code !== 1) {
    throw new Error(
      `FebBox file listing failed: ${response.data?.msg || 'unknown response'}`
    )
  }
  return response.data.data?.file_list || []
}

function matchesSeason(name: string, season: number): boolean {
  const value = name.toLowerCase()
  const number = String(season)
  return (
    new RegExp(`(?:^|\\b)season[ ._-]*0*${number}(?:\\b|$)`, 'i').test(value) ||
    new RegExp(`(?:^|\\b)s0*${number}(?:\\b|$)`, 'i').test(value)
  )
}

function matchesEpisode(
  name: string,
  season: number,
  episode: number,
  insideSeasonDirectory: boolean
): boolean {
  const seasonNumber = String(season)
  const episodeNumber = String(episode)
  if (
    new RegExp(
      `(?:^|\\W)s0*${seasonNumber}[ ._-]*e0*${episodeNumber}(?:\\W|$)`,
      'i'
    ).test(name)
  ) {
    return true
  }
  if (
    new RegExp(
      `season[ ._-]*0*${seasonNumber}[ ._-]*(?:episode|ep|e)[ ._-]*0*${episodeNumber}(?:\\W|$)`,
      'i'
    ).test(name)
  ) {
    return true
  }
  return (
    insideSeasonDirectory &&
    new RegExp(
      `(?:^|\\W)(?:episode|ep|e)[ ._-]*0*${episodeNumber}(?:\\W|$)`,
      'i'
    ).test(name)
  )
}

async function collectVideoFiles(
  shareKey: string,
  entries: FebBoxFile[],
  depth = 0
): Promise<FebBoxFile[]> {
  const files = entries.filter(
    entry => entry.is_dir !== 1 && VIDEO_EXTENSION.test(entry.file_name)
  )
  if (depth >= 3) return files

  const directories = entries.filter(entry => entry.is_dir === 1).slice(0, 30)
  const children = await Promise.all(
    directories.map(async directory =>
      collectVideoFiles(
        shareKey,
        await listShareFiles(shareKey, directory.fid),
        depth + 1
      )
    )
  )
  return files.concat(...children)
}

async function selectMediaFiles(
  shareKey: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<FebBoxFile[]> {
  const root = await listShareFiles(shareKey)
  if (mediaType === 'movie') return collectVideoFiles(shareKey, root)
  if (season === undefined || episode === undefined) return []

  const seasonDirectories = root.filter(
    entry => entry.is_dir === 1 && matchesSeason(entry.file_name, season)
  )
  if (seasonDirectories.length) {
    const seasonFiles = (
      await Promise.all(
        seasonDirectories.map(async directory =>
          collectVideoFiles(
            shareKey,
            await listShareFiles(shareKey, directory.fid)
          )
        )
      )
    ).flat()
    return seasonFiles.filter(file =>
      matchesEpisode(file.file_name, season, episode, true)
    )
  }

  const allFiles = await collectVideoFiles(shareKey, root)
  return allFiles.filter(file =>
    matchesEpisode(file.file_name, season, episode, false)
  )
}

function parsePlayerSources(html: string): FebBoxPlayerSource[] {
  const sourceJson = html.match(/\bvar\s+sources\s*=\s*(\[[\s\S]*?\])\s*;/)?.[1]
  if (!sourceJson) {
    const errorMessage = html.match(/"msg"\s*:\s*"([^"]+)"/)?.[1]
    throw new Error(errorMessage || 'FebBox player returned no sources')
  }

  const sources = JSON.parse(sourceJson) as FebBoxPlayerSource[]
  const explicit = sources.filter(
    source => source.file && source.label?.toUpperCase() !== 'AUTO'
  )
  return explicit.length ? explicit : sources.filter(source => source.file)
}

async function resolveFileStreams(
  shareKey: string,
  file: FebBoxFile,
  cookie: string,
  fileIndex: number
): Promise<ProviderLink[]> {
  const body = new URLSearchParams({
    fid: String(file.fid),
    share_key: shareKey,
  })
  const response = await axios.post<string>(
    `${FEBBOX_BASE_URL}/file/player`,
    body.toString(),
    {
      headers: {
        ...PUBLIC_HEADERS,
        Cookie: normalizeCookieHeader(cookie),
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${FEBBOX_BASE_URL}/share/${shareKey}`,
      },
      timeout: REQUEST_TIMEOUT_MS,
    }
  )
  const sources = parsePlayerSources(String(response.data))

  return Promise.all(
    sources
      .filter((source): source is FebBoxPlayerSource & { file: string } =>
        Boolean(source.file && /^https?:\/\//i.test(source.file))
      )
      .map(async source => {
        const details = await inspectRendition(source.file)
        const { quality } = parseQualityFromLabel(
          source.label || file.file_name
        )
        return {
          server: `ShowBox ${fileIndex + 1}`,
          url: source.file,
          isM3U8:
            /\.m3u8(?:$|[?#])/i.test(source.file) ||
            source.file.includes('/hls/'),
          quality: buildQualityString(
            quality,
            details.codecs,
            details.estimatedSize
          ),
          subtitles: [] as Subtitle[],
          headers: PLAYBACK_HEADERS,
          requiresProxy: true,
        }
      })
  )
}

async function getShowBoxStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number,
  full = false
): Promise<ProviderLink[]> {
  console.log(
    `[ShowBox] Getting streams for TMDB ${mediaType}/${tmdbId}${
      season !== undefined ? ` S${season}` : ''
    }${episode !== undefined ? `E${episode}` : ''}`
  )

  try {
    const cookie = await selectBestCookie()
    if (!cookie) return []

    const metadata = await getMetadata(tmdbId, mediaType, season, episode)
    const detailPath = await findDetailPath(metadata, mediaType)
    const shareKey = await getShareKey(detailPath, mediaType)
    const files = await selectMediaFiles(shareKey, mediaType, season, episode)
    if (!files.length) {
      console.log('[ShowBox] No matching FebBox video files found')
      return []
    }

    const prioritizedFiles = files
      .map((file, index) => ({ file, index }))
      .reverse()
    const allStreams: ProviderLink[] = []
    console.log(`[ShowBox] Resolving ${prioritizedFiles.length} FebBox file(s)`)
    for (const { file, index } of prioritizedFiles) {
      try {
        const streams = await resolveFileStreams(shareKey, file, cookie, index)
        if (!streams.length) continue
        const unique = Array.from(
          new Map(
            streams.map(stream => [
              `${new URL(stream.url).pathname}|${stream.quality}|${stream.server}`,
              stream,
            ])
          ).values()
        )
        unique.sort((left, right) => {
          return (
            parseQualityFromLabel(right.quality).priority -
            parseQualityFromLabel(left.quality).priority
          )
        })
        if (!full) {
          console.log(`[ShowBox] Returning ${unique.length} sorted stream(s)`)
          return unique
        }
        allStreams.push(...unique)
      } catch (error) {
        console.warn(
          `[ShowBox] Could not resolve "${file.file_name}": ${
            error instanceof Error ? error.message : 'unknown error'
          }`
        )
      }
    }
    const unique = Array.from(
      new Map(
        allStreams.map(stream => [
          `${stream.server}|${stream.url}|${stream.quality}`,
          stream,
        ])
      ).values()
    )
    unique.sort(
      (left, right) =>
        parseQualityFromLabel(right.quality).priority -
        parseQualityFromLabel(left.quality).priority
    )
    console.log(`[ShowBox] Returning ${unique.length} sorted stream(s)`)
    return unique
  } catch (error) {
    console.error(
      `[ShowBox] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export function configureShowBoxCookies(cookies: string | string[]): void {
  cookiePool = (typeof cookies === 'string' ? cookies.split(',') : cookies)
    .map(cookie => cookie.trim())
    .filter(Boolean)
  currentCookieIndex = 0
  console.log(`[ShowBox] Configured ${cookiePool.length} cookie(s)`)
}

/**
 * Retained for source compatibility. The retired Nuvio wrapper used these URL
 * proxies; the direct first-party flow intentionally does not send FebBox
 * authentication cookies through them.
 */
export function configureShowBoxProxies(_proxies: string | string[]): void {
  void _proxies
  console.warn(
    '[ShowBox] Custom URL proxies are ignored by the direct ShowBox/FebBox integration'
  )
}

export const showboxProvider: Provider = {
  name: 'ShowBox',
  id: 'showbox',
  alias: 'Adwa',
  streamMovie: (tmdbId, options) =>
    getShowBoxStreams(tmdbId, 'movie', undefined, undefined, options?.full),
  streamTV: (tmdbId, season, episode, options) =>
    getShowBoxStreams(tmdbId, 'tv', season, episode, options?.full),
}
