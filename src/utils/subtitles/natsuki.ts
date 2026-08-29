import type { Subtitle } from '../../types/index.js'
import { getProviderCache, setProviderCache } from '../redis.js'
import { decodeSubtitleBytes } from './vtt.js'
import type { SubtitleProvider, SubtitleQuery } from './types.js'
import { subtitleFilePath } from './paths.js'

const NATSUKI_BASE_URL = 'https://natsuki.maybeoneday.ch'
/**
 * The host only answers requests that carry a zstream.mov `Origin` or
 * `Referer`; anything else is rejected with HTTP 403.
 */
const NATSUKI_ORIGIN = 'https://zstream.mov'
const SEARCH_TIMEOUT_MS = 12_000
/**
 * File downloads are chunked without a `Content-Length` and the host throttles
 * bursts hard, so this is deliberately more generous than the search timeout.
 */
const FILE_TIMEOUT_MS = 30_000
const SEARCH_CACHE_TTL_SECONDS = 6 * 60 * 60
/** Upstream returns up to ~130 entries; cap per language to keep pickers sane. */
const DEFAULT_MAX_PER_LANGUAGE = 5
const MAX_FILE_BYTES = 4 * 1024 * 1024

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'

function requestHeaders(): Record<string, string> {
  return {
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.7',
    origin: NATSUKI_ORIGIN,
    priority: 'u=1, i',
    referer: `${NATSUKI_ORIGIN}/`,
    'sec-ch-ua': '"Not=A?Brand";v="99", "Brave";v="151", "Chromium";v="151"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'cross-site',
    'sec-gpc': '1',
    'user-agent': BROWSER_USER_AGENT,
    // Subtitle lookups use the server's direct egress; the origin allowlist
    // above is what grants access, so forward proxies only add failure modes.
    'x-skip-forward-proxy': 'true',
  }
}

/** Entry shape of the upstream `/subs` response. Unused fields are omitted. */
interface NatsukiSubtitleEntry {
  sid?: string
  language?: string
  langCode?: string
  url?: string
  fileName?: string
  date?: string
  hearingImpaired?: boolean
  translatedFrom?: string
}

interface NatsukiSearchResponse {
  fid?: string
  imdbId?: string
  /** Release name of the file the subtitles were matched against. */
  title?: string
  cached?: boolean
  subtitles?: NatsukiSubtitleEntry[]
}

function maxPerLanguage(): number {
  const raw = process.env.SUBTITLE_MAX_PER_LANGUAGE
  if (!raw) return DEFAULT_MAX_PER_LANGUAGE

  const parsed = Number.parseInt(raw, 10)
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_PER_LANGUAGE
}

function searchUrl(query: SubtitleQuery): string {
  const params = new URLSearchParams({ tmdbId: query.tmdbId })
  if (query.season !== undefined && query.episode !== undefined) {
    params.set('season', String(query.season))
    params.set('episode', String(query.episode))
  }

  return `${NATSUKI_BASE_URL}/subs?${params.toString()}`
}

function cacheKey(query: SubtitleQuery): string {
  const suffix =
    query.season !== undefined && query.episode !== undefined
      ? `:s${query.season}:e${query.episode}`
      : ''
  return `flixquest:provider:subs:natsuki:${query.tmdbId}${suffix}`
}

/** Splits a release name into comparable tokens (`1080p`, `web`, `amzn`, …). */
function releaseTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/\.(?:srt|vtt|ssa|ass|sub|mkv|mp4|avi)$/i, '')
      .split(/[^a-z0-9]+/)
      .filter(token => token.length > 1)
  )
}

/**
 * Overlap between a subtitle's file name and the release the upstream matched.
 * Subtitles cut for the same release are the ones most likely to be in sync.
 */
function releaseAffinity(fileName: string, release: Set<string>): number {
  if (release.size === 0 || !fileName) return 0

  const tokens = releaseTokens(fileName)
  if (tokens.size === 0) return 0

  let shared = 0
  for (const token of tokens) {
    if (release.has(token)) shared += 1
  }

  return shared / release.size
}

function parseDate(value: string | undefined): number {
  if (!value) return 0
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function languageLabel(entry: NatsukiSubtitleEntry): string {
  const raw = (entry.language || entry.langCode || '').trim()
  if (!raw) return 'Unknown'

  // Some entries carry a code where a name belongs ("Pb", "Ckb").
  return raw.length <= 3 ? raw.toUpperCase() : raw
}

function languageCode(entry: NatsukiSubtitleEntry): string | undefined {
  const code = (entry.langCode || '').trim().toLowerCase()
  return /^[a-z]{2,3}(?:-[a-z]{2,4})?$/.test(code) ? code : undefined
}

/**
 * Order candidates for one language best-first: human translations before
 * machine ones, plain subtitles before SDH, then release affinity and recency.
 */
function rankEntries(
  entries: NatsukiSubtitleEntry[],
  release: Set<string>
): NatsukiSubtitleEntry[] {
  return entries
    .map(entry => ({
      entry,
      translated: entry.translatedFrom ? 1 : 0,
      hearingImpaired: entry.hearingImpaired ? 1 : 0,
      affinity: releaseAffinity(entry.fileName || '', release),
      date: parseDate(entry.date),
    }))
    .sort(
      (a, b) =>
        a.translated - b.translated ||
        a.hearingImpaired - b.hearingImpaired ||
        b.affinity - a.affinity ||
        b.date - a.date
    )
    .map(ranked => ranked.entry)
}

/** English first, then alphabetically, so the common case is at the top. */
function compareLanguages(a: string, b: string): number {
  const aEnglish = a.toLowerCase().startsWith('english') ? 0 : 1
  const bEnglish = b.toLowerCase().startsWith('english') ? 0 : 1
  return aEnglish - bEnglish || a.localeCompare(b)
}

function toSubtitles(payload: NatsukiSearchResponse): Subtitle[] {
  const entries = (payload.subtitles || []).filter(
    entry => typeof entry.sid === 'string' && /^\d+$/.test(entry.sid)
  )
  if (entries.length === 0) return []

  const release = releaseTokens(payload.title || '')
  const byLanguage = new Map<string, NatsukiSubtitleEntry[]>()
  for (const entry of entries) {
    const label = languageLabel(entry)
    const bucket = byLanguage.get(label)
    if (bucket) bucket.push(entry)
    else byLanguage.set(label, [entry])
  }

  const limit = maxPerLanguage()
  const subtitles: Subtitle[] = []

  for (const label of [...byLanguage.keys()].sort(compareLanguages)) {
    const ranked = rankEntries(byLanguage.get(label) || [], release).slice(
      0,
      limit
    )

    ranked.forEach((entry, index) => {
      const suffixes: string[] = []
      if (entry.hearingImpaired) suffixes.push('SDH')
      if (entry.translatedFrom) suffixes.push('MT')
      // Disambiguate same-language alternatives for clients rendering a picker.
      if (index > 0) suffixes.push(`#${index + 1}`)

      subtitles.push({
        file: subtitleFilePath('natsuki', entry.sid as string, {
          language: languageCode(entry),
        }),
        label: suffixes.length ? `${label} (${suffixes.join(', ')})` : label,
        kind: entry.hearingImpaired ? 'captions' : 'subtitles',
      })
    })
  }

  return subtitles
}

async function search(query: SubtitleQuery): Promise<Subtitle[]> {
  const key = cacheKey(query)
  const cached = await getProviderCache<Subtitle[]>(key)
  if (cached) {
    console.log(`[NatsukiSubs] Cache HIT (${cached.length} subtitle(s))`)
    return cached
  }

  try {
    const response = await fetch(searchUrl(query), {
      headers: requestHeaders(),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    })

    if (!response.ok) {
      console.warn(`[NatsukiSubs] HTTP ${response.status} from /subs`)
      return []
    }

    const payload = (await response.json()) as NatsukiSearchResponse
    const subtitles = toSubtitles(payload)

    if (subtitles.length === 0) {
      console.log('[NatsukiSubs] No subtitles found')
      return []
    }

    console.log(`[NatsukiSubs] Fetched ${subtitles.length} subtitle(s)`)
    await setProviderCache(key, subtitles, SEARCH_CACHE_TTL_SECONDS)
    return subtitles
  } catch (error) {
    console.warn(
      `[NatsukiSubs] ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return []
  }
}

export const natsukiSubtitleProvider: SubtitleProvider = {
  id: 'natsuki',
  name: 'Natsuki Subs',
  search,
}

/**
 * Download and decode one subtitle file.
 *
 * @param sid          Upstream subtitle id (digits only)
 * @param languageHint ISO 639 code used to pick a legacy code page when the
 *                     bytes are not valid UTF-8
 * @returns Decoded subtitle text, still in its original format
 */
export async function fetchNatsukiSubtitleFile(
  sid: string,
  languageHint?: string
): Promise<string> {
  const response = await fetch(`${NATSUKI_BASE_URL}/s/${sid}.srt`, {
    headers: requestHeaders(),
    signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`Upstream responded with HTTP ${response.status}`)
  }

  const buffer = await response.arrayBuffer()
  if (buffer.byteLength === 0) {
    throw new Error('Upstream returned an empty subtitle file')
  }
  if (buffer.byteLength > MAX_FILE_BYTES) {
    throw new Error('Upstream subtitle file is too large')
  }

  const text = decodeSubtitleBytes(
    new Uint8Array(buffer),
    undefined,
    languageHint
  )

  // Failed lookups come back as a short plain-text body ("error code: 502").
  if (!text.includes('-->')) {
    throw new Error('Upstream returned a subtitle file with no cues')
  }

  return text
}
