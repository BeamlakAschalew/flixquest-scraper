/**
 * Vuflix dynamic multi-source resolver (https://vuflix.co).
 *
 * Vuflix publishes its current provider catalog and resolves each backend
 * independently. Source failures are isolated, and primary streams, explicit
 * qualities, fallback candidates, and language-switch URLs are all retained.
 */
import type { Provider, ProviderLink, Subtitle } from '../types/index.js'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'

const SITE_URL = 'https://vuflix.co'
const API_BASE_URL = `${SITE_URL}/api/player`
const CATALOG_TIMEOUT_MS = Math.min(DEFAULT_REQUEST_TIMEOUT_MS, 15_000)
const API_HEADERS = {
  Accept: 'application/json',
  Origin: SITE_URL,
  Referer: `${SITE_URL}/`,
}

const FALLBACK_PROVIDERS: VuflixProviderEntry[] = [
  { id: 'vsembed', name: 'Sigma', scrapeTimeoutSec: 120 },
  { id: 'cineplay', name: '4K', scrapeTimeoutSec: 90 },
  { id: 'bingr', name: 'Upsilon', scrapeTimeoutSec: 45 },
  { id: 'filesun', name: 'Tau', scrapeTimeoutSec: 45 },
  { id: 'onlyflix', name: 'Gamma', scrapeTimeoutSec: 45 },
  { id: 'vaplayer', name: 'Alpha', scrapeTimeoutSec: 45 },
  { id: 'moviebox', name: 'Pi', scrapeTimeoutSec: 45 },
  { id: 'flixhqz', name: 'Gamma', scrapeTimeoutSec: 90 },
  { id: 'huhu', name: 'Beta', scrapeTimeoutSec: 45 },
  { id: 'cinejoy', name: '4K2', scrapeTimeoutSec: 45 },
]

interface VuflixProviderEntry {
  id?: string
  name?: string
  publicLabel?: string
  providerName?: string
  scrapeTimeoutSec?: number
}

interface VuflixProviderResponse {
  providers?: VuflixProviderEntry[]
}

interface VuflixSubtitle {
  src?: string
  url?: string
  file?: string
  label?: string
  language?: string
  lang?: string
}

interface VuflixStreamVariant {
  url?: string
  file?: string
  quality?: string | number
  type?: string
  format?: string
  label?: string
  name?: string
  language?: string
  lang?: string
  switchUrl?: string
  headers?: Record<string, unknown>
}

interface VuflixSource extends VuflixStreamVariant {
  provider?: string
  providerName?: string
  publicLabel?: string
  hasEnglish?: boolean
  candidates?: VuflixStreamVariant[]
  qualities?: VuflixStreamVariant[]
  audioTracks?: VuflixStreamVariant[]
  subtitles?: VuflixSubtitle[]
  meta?: Record<string, unknown>
}

interface VuflixSourceResponse {
  ok?: boolean
  error?: string
  sources?: VuflixSource[] | null
  subtitles?: VuflixSubtitle[] | null
}

interface LinkCandidate {
  stream: VuflixStreamVariant
  role?: string
  inheritedQuality?: string | number
  inheritedLanguage?: string
  sourceLabel?: string
  audioLabels?: string[]
}

function isValidTmdbId(tmdbId: string): boolean {
  return /^\d+$/.test(tmdbId)
}

function isValidEpisodeNumber(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function validHttpUrl(value: string | undefined): URL | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

async function requestJson<T>(url: string, timeoutMs: number): Promise<T> {
  const response = await fetch(url, {
    headers: API_HEADERS,
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} from ${new URL(response.url || url).hostname}`
    )
  }
  return (await response.json()) as T
}

function providerLabel(provider: VuflixProviderEntry): string {
  return (
    provider.publicLabel ||
    provider.providerName ||
    provider.name ||
    provider.id ||
    'Source'
  ).trim()
}

function normalizedProviders(
  payload: VuflixProviderResponse
): VuflixProviderEntry[] {
  if (!Array.isArray(payload.providers)) return []
  return Array.from(
    new Map(
      payload.providers.flatMap(provider => {
        const id = provider.id?.trim().toLowerCase()
        if (!id || !/^[a-z0-9_-]+$/.test(id)) return []
        return [[id, { ...provider, id }] as const]
      })
    ).values()
  )
}

async function getProviders(): Promise<VuflixProviderEntry[]> {
  try {
    const providers = normalizedProviders(
      await requestJson<VuflixProviderResponse>(
        `${API_BASE_URL}/providers`,
        CATALOG_TIMEOUT_MS
      )
    )
    return providers.length ? providers : FALLBACK_PROVIDERS
  } catch {
    return FALLBACK_PROVIDERS
  }
}

function providerTimeoutMs(provider: VuflixProviderEntry): number {
  const seconds = Number(provider.scrapeTimeoutSec)
  const boundedSeconds = Number.isFinite(seconds)
    ? Math.max(15, Math.min(120, seconds))
    : Math.max(15, Math.min(120, DEFAULT_REQUEST_TIMEOUT_MS / 1000))
  return boundedSeconds * 1000
}

function normalizedQuality(value: string | number | undefined): string {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
  if (/2160|\b4k\b/.test(raw)) return '2160p'
  const match = raw.match(/(\d{3,4})p?/)
  if (match) return `${match[1]}p`
  if (raw === 'hd') return '720p'
  return 'auto'
}

function normalizedHeaders(
  headers: Record<string, unknown> | undefined
): Record<string, string> | undefined {
  if (!headers) return undefined
  const entries = Object.entries(headers).flatMap(([key, value]) =>
    typeof value === 'string' && key.trim() && value.trim()
      ? [[key, value] as const]
      : []
  )
  return entries.length ? Object.fromEntries(entries) : undefined
}

function subtitlesFrom(entries: VuflixSubtitle[] = []): Subtitle[] {
  return Array.from(
    new Map(
      entries.flatMap(entry => {
        const url = validHttpUrl(entry.src || entry.url || entry.file)
        if (!url) return []
        const subtitle: Subtitle = {
          file: url.href,
          label: entry.label || entry.language || entry.lang || 'Unknown',
          kind: 'captions',
        }
        return [[`${subtitle.file}\n${subtitle.label}`, subtitle] as const]
      })
    ).values()
  )
}

function languageName(value: string | undefined): string | undefined {
  const raw = value?.trim()
  if (!raw) return undefined
  const names: Record<string, string> = {
    de: 'German',
    en: 'English',
    eng: 'English',
    hi: 'Hindi',
    hin: 'Hindi',
  }
  return names[raw.toLowerCase()] || raw
}

function cleanSourceLabel(
  value: string | undefined,
  publicLabel: string
): string {
  if (!value) return ''
  const escaped = publicLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return value
    .replace(new RegExp(`^${escaped}\\s*(?:[|:.-]|\\u00b7)?\\s*`, 'i'), '')
    .trim()
}

function sourceAudioLabels(source: VuflixSource): string[] {
  return Array.from(
    new Set(
      (source.audioTracks || [])
        .map(track =>
          languageName(
            track.label || track.name || track.language || track.lang
          )
        )
        .filter((label): label is string => Boolean(label))
    )
  )
}

function candidatesFrom(
  source: VuflixSource,
  publicLabel: string
): LinkCandidate[] {
  const inheritedLanguage = source.language || source.lang
  const sourceLabel = cleanSourceLabel(source.label, publicLabel)
  const audioLabels = sourceAudioLabels(source)
  const candidates: LinkCandidate[] = []

  for (const quality of source.qualities || []) {
    candidates.push({
      stream: quality,
      role: 'Quality',
      inheritedQuality: source.quality,
      inheritedLanguage,
      sourceLabel,
      audioLabels,
    })
  }
  for (const [index, candidate] of (source.candidates || []).entries()) {
    candidates.push({
      stream: candidate,
      role: `Candidate ${index + 1}`,
      inheritedQuality: source.quality,
      inheritedLanguage,
      sourceLabel,
      audioLabels,
    })
  }
  for (const track of source.audioTracks || []) {
    if (!track.switchUrl && !track.url && !track.file) continue
    candidates.push({
      stream: { ...track, url: track.switchUrl || track.url || track.file },
      role: languageName(
        track.label || track.name || track.language || track.lang
      ),
      inheritedQuality: source.quality,
      inheritedLanguage: track.language || track.lang || inheritedLanguage,
      sourceLabel,
    })
  }
  candidates.push({
    stream: source,
    inheritedQuality: source.quality,
    inheritedLanguage,
    sourceLabel,
    audioLabels,
  })
  return candidates
}

function linkFromCandidate(
  provider: VuflixProviderEntry,
  source: VuflixSource,
  candidate: LinkCandidate,
  subtitles: Subtitle[]
): ProviderLink | null {
  const url = validHttpUrl(
    candidate.stream.switchUrl || candidate.stream.url || candidate.stream.file
  )
  if (!url) return null

  const format = (
    candidate.stream.type ||
    candidate.stream.format ||
    source.type ||
    source.format ||
    ''
  ).toLowerCase()
  const quality = normalizedQuality(
    candidate.stream.quality ?? candidate.inheritedQuality
  )
  const publicLabel = providerLabel(provider)
  const language = languageName(
    candidate.stream.language ||
      candidate.stream.lang ||
      candidate.inheritedLanguage
  )
  const variantLabel = cleanSourceLabel(
    candidate.stream.label || candidate.stream.name,
    publicLabel
  )
  const audioSummary = candidate.audioLabels?.length
    ? candidate.audioLabels.join('/')
    : undefined
  const details = [
    candidate.sourceLabel,
    variantLabel,
    candidate.role,
    language,
    audioSummary,
    quality !== 'auto' ? quality : undefined,
  ].filter(
    (value, index, all): value is string =>
      Boolean(value) && all.indexOf(value) === index
  )
  const headers = normalizedHeaders(candidate.stream.headers || source.headers)
  const ownSubtitles = subtitlesFrom(source.subtitles)
  const mergedSubtitles = Array.from(
    new Map(
      [...subtitles, ...ownSubtitles].map(
        subtitle => [`${subtitle.file}\n${subtitle.label}`, subtitle] as const
      )
    ).values()
  )

  return {
    server: `Vuflix | ${publicLabel} (${provider.id})${details.length ? ` | ${details.join(' | ')}` : ''}`,
    url: url.href,
    isM3U8:
      format === 'hls' ||
      format.includes('mpegurl') ||
      /\.m3u8(?:$|[?#])/i.test(url.href) ||
      url.pathname.includes('/api/player/lang-proxy'),
    isDASH: format === 'dash' || /\.mpd(?:$|[?#])/i.test(url.href),
    quality,
    subtitles: mergedSubtitles,
    headers,
    requiresProxy: Boolean(headers),
  }
}

function isCineplayPlaceholder(source: VuflixSource): boolean {
  const type = String(source.type || source.format || '').toLowerCase()
  const url = String(source.url || source.file || '')
  return (
    type === 'cineplay' ||
    type === 'cineplay-yoru' ||
    /^cineplay-yoru:\/\//i.test(url)
  )
}

async function resolveCineplayPlaceholder(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  timeoutMs: number,
  season?: number,
  episode?: number
): Promise<VuflixSource[]> {
  const url = new URL(`${SITE_URL}/api/cineplay/yoru`)
  url.searchParams.set('type', mediaType)
  url.searchParams.set('tmdbId', tmdbId)
  if (mediaType === 'tv') {
    url.searchParams.set('season', String(season))
    url.searchParams.set('episode', String(episode))
  }
  const payload = await requestJson<VuflixSourceResponse>(url.href, timeoutMs)
  return payload.ok && Array.isArray(payload.sources) ? payload.sources : []
}

async function fetchProvider(
  provider: VuflixProviderEntry,
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  const providerId = provider.id!
  const url = new URL(`${API_BASE_URL}/sources`)
  url.searchParams.set('type', mediaType)
  url.searchParams.set('tmdbId', tmdbId)
  url.searchParams.set('provider', providerId)
  if (mediaType === 'tv') {
    url.searchParams.set('season', String(season))
    url.searchParams.set('episode', String(episode))
  }

  const timeoutMs = providerTimeoutMs(provider)
  const payload = await requestJson<VuflixSourceResponse>(url.href, timeoutMs)
  if (!payload.ok || !Array.isArray(payload.sources)) return []

  let sources = payload.sources
  if (sources.some(isCineplayPlaceholder)) {
    const resolved = await resolveCineplayPlaceholder(
      tmdbId,
      mediaType,
      timeoutMs,
      season,
      episode
    ).catch(() => [])
    sources = [
      ...sources.filter(source => !isCineplayPlaceholder(source)),
      ...resolved,
    ]
  }

  const sharedSubtitles = subtitlesFrom(payload.subtitles || [])
  const links = sources.flatMap(source =>
    candidatesFrom(source, providerLabel(provider)).flatMap(candidate => {
      const link = linkFromCandidate(
        provider,
        source,
        candidate,
        sharedSubtitles
      )
      return link ? [link] : []
    })
  )
  const unique = new Map<string, ProviderLink>()
  for (const link of links) {
    if (!unique.has(link.url)) unique.set(link.url, link)
  }
  return Array.from(unique.values())
}

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  if (!isValidTmdbId(tmdbId)) return []
  if (
    mediaType === 'tv' &&
    (!isValidEpisodeNumber(season!) || !isValidEpisodeNumber(episode!))
  ) {
    return []
  }

  try {
    const providers = await getProviders()
    const results = await Promise.allSettled(
      providers.map(provider =>
        fetchProvider(provider, tmdbId, mediaType, season, episode)
      )
    )
    const links = results.flatMap(result =>
      result.status === 'fulfilled' ? result.value : []
    )
    console.log(
      `[Vuflix] Queried ${providers.length} backend(s) and extracted ${links.length} stream(s) for ${mediaType} ${tmdbId}`
    )
    return links
  } catch (error) {
    console.error(
      `[Vuflix] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const vuflixProvider: Provider = {
  name: 'Vuflix',
  id: 'vuflix',
  alias: 'Adulis',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
