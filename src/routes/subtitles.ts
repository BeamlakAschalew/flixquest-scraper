import { createHash } from 'node:crypto'
import { Router } from 'express'
import type { Request, Response } from 'express'
import { apiBaseUrl } from '../utils/api-base-url.js'
import { fetchNatsukiSubtitleFile } from '../utils/subtitles/natsuki.js'
import { fetchWyzieSubtitleFile } from '../utils/subtitles/wyzie.js'
import {
  fetchSubtitleCatalog,
  withAbsoluteCatalogUrls,
} from '../utils/subtitles/index.js'
import {
  decodeSubtitleFileToken,
  type SubtitleFileToken,
} from '../utils/subtitles/tokens.js'
import { convertSubtitle } from '../utils/subtitles/vtt.js'
import type { SubtitleOutputFormat } from '../utils/subtitles/types.js'
import { getProviderCache, setProviderCache } from '../utils/redis.js'

export const subtitlesRouter = Router()

const CACHE_TTL_SECONDS = 24 * 60 * 60
const BROWSER_CACHE_SECONDS = 24 * 60 * 60
/** Search results carry signed URLs, so they are only briefly reusable. */
const SEARCH_BROWSER_CACHE_SECONDS = 5 * 60

const CONTENT_TYPES: Record<SubtitleOutputFormat, string> = {
  vtt: 'text/vtt; charset=utf-8',
  srt: 'application/x-subrip; charset=utf-8',
}

/**
 * GET /api/v2/subtitles/search?tmdbId=550[&season=1&episode=2]
 *
 * Every subtitle the configured providers offer for one title, so clients can
 * render their own picker without talking to the subtitle hosts themselves.
 */
subtitlesRouter.get('/search', async (req: Request, res: Response) => {
  const tmdbId = digits(req.query.tmdbId)
  if (!tmdbId) {
    res.status(400).json({
      success: false,
      error: 'Missing or invalid tmdbId parameter',
    })
    return
  }

  const season = digits(req.query.season)
  const episode = digits(req.query.episode)
  if (Boolean(season) !== Boolean(episode)) {
    res.status(400).json({
      success: false,
      error: 'Both season and episode are required for TV subtitles',
    })
    return
  }

  try {
    const entries = await fetchSubtitleCatalog({
      tmdbId,
      season: season ? Number(season) : undefined,
      episode: episode ? Number(episode) : undefined,
    })

    res.setHeader(
      'Cache-Control',
      `private, max-age=${SEARCH_BROWSER_CACHE_SECONDS}`
    )
    res.json({
      success: true,
      tmdbId,
      ...(season && episode
        ? { season: Number(season), episode: Number(episode) }
        : {}),
      count: entries.length,
      subtitles: withAbsoluteCatalogUrls(entries, apiBaseUrl(req)),
    })
  } catch (error) {
    console.warn(
      `[Subtitles] search ${tmdbId}: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    )
    res.status(502).json({
      success: false,
      error: 'Failed to search subtitles',
      details: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

/**
 * Upstream subtitle hosts gate access on their own `Origin` allowlist and serve
 * SubRip as `application/octet-stream`, so their URLs cannot be handed to
 * clients directly. This route fetches, decodes and normalizes them instead.
 */
subtitlesRouter.get('/natsuki/:file', async (req: Request, res: Response) => {
  const parsed = parseFileParam(req.params.file, /^\d+$/)
  if (!parsed) {
    sendBadPath(res, '/natsuki/{id}.vtt or /natsuki/{id}.srt')
    return
  }

  const { id: sid, format } = parsed
  const language = languageHint(req.query.l)

  await serveSubtitle(res, {
    label: `natsuki/${sid}`,
    cacheKey: `flixquest:provider:subs:natsuki:file:${sid}:${format}`,
    format,
    fetchRaw: () => fetchNatsukiSubtitleFile(sid, language),
  })
})

/**
 * Wyzie hands out links to whichever aggregator hosts a file, so the URL rides
 * along in a signed `t` token instead of being addressable by id. Serving it
 * here keeps clients off the upstream hosts and the route off open-proxy duty.
 */
subtitlesRouter.get('/wyzie/:file', async (req: Request, res: Response) => {
  const parsed = parseFileParam(req.params.file)
  if (!parsed) {
    sendBadPath(res, '/wyzie/{id}.vtt or /wyzie/{id}.srt')
    return
  }

  const { id, format } = parsed
  const rawToken = typeof req.query.t === 'string' ? req.query.t : ''

  let token: SubtitleFileToken
  try {
    token = decodeSubtitleFileToken(rawToken)
  } catch (error) {
    res.status(400).json({
      success: false,
      error: 'Invalid subtitle token',
      details: error instanceof Error ? error.message : 'Unknown error',
      // Tokens expire; a fresh one comes from /api/v2/subtitles/search.
    })
    return
  }

  await serveSubtitle(res, {
    label: `wyzie/${id}`,
    cacheKey: `flixquest:provider:subs:wyzie:file:${fingerprint(
      token.url
    )}:${format}`,
    format,
    fetchRaw: () => fetchWyzieSubtitleFile(token),
  })
})

/**
 * Serve one subtitle file: Redis first, then the upstream host, converted to
 * the requested wire format either way.
 */
async function serveSubtitle(
  res: Response,
  options: {
    label: string
    cacheKey: string
    format: SubtitleOutputFormat
    fetchRaw: () => Promise<string>
  }
): Promise<void> {
  const { label, cacheKey, format, fetchRaw } = options

  try {
    const cached = await getProviderCache<string>(cacheKey)
    if (cached) {
      sendSubtitle(res, cached, format, 'HIT')
      return
    }

    const converted = convertSubtitle(await fetchRaw(), format)

    await setProviderCache(cacheKey, converted, CACHE_TTL_SECONDS)
    sendSubtitle(res, converted, format, 'MISS')
  } catch (error) {
    console.warn(
      `[Subtitles] ${label}: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    )
    res.status(502).json({
      success: false,
      error: 'Failed to fetch subtitle file',
      details: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

/**
 * Split a `{id}.{format}` path segment.
 *
 * @param value     Raw path parameter
 * @param idPattern Extra constraint on the id, e.g. digits-only for providers
 *                  whose ids are interpolated into an upstream URL
 */
function parseFileParam(
  value: unknown,
  idPattern = /^[A-Za-z0-9_-]{1,64}$/
): { id: string; format: SubtitleOutputFormat } | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  const match = /^([A-Za-z0-9_-]{1,64})\.(vtt|srt)$/i.exec(
    (typeof raw === 'string' ? raw : '').trim()
  )
  if (!match || !idPattern.test(match[1])) return undefined

  return {
    id: match[1],
    format: match[2].toLowerCase() as SubtitleOutputFormat,
  }
}

function sendBadPath(res: Response, expected: string): void {
  res.status(400).json({
    success: false,
    error: 'Invalid subtitle file',
    details: `Expected a path of the form ${expected}`,
  })
}

function digits(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? value.trim() : ''
  return /^\d{1,10}$/.test(raw) ? raw : undefined
}

function languageHint(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return /^[a-z]{2,3}(?:-[a-z]{2,4})?$/.test(raw) ? raw : undefined
}

/** Cache identity of an upstream file, so signed tokens stay out of Redis keys. */
function fingerprint(url: string): string {
  return createHash('sha1').update(url).digest('hex')
}

function sendSubtitle(
  res: Response,
  body: string,
  format: SubtitleOutputFormat,
  cacheState: 'HIT' | 'MISS'
): void {
  res.setHeader('Content-Type', CONTENT_TYPES[format])
  // Subtitle text is fetched cross-origin by browser players.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', `public, max-age=${BROWSER_CACHE_SECONDS}`)
  res.setHeader('X-Cache', cacheState)
  res.send(body)
}
