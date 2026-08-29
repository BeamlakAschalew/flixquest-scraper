import { Router } from 'express'
import type { Request, Response } from 'express'
import { fetchNatsukiSubtitleFile } from '../utils/subtitles/natsuki.js'
import { convertSubtitle } from '../utils/subtitles/vtt.js'
import type { SubtitleOutputFormat } from '../utils/subtitles/types.js'
import { getProviderCache, setProviderCache } from '../utils/redis.js'

export const subtitlesRouter = Router()

const CACHE_TTL_SECONDS = 24 * 60 * 60
const BROWSER_CACHE_SECONDS = 24 * 60 * 60

const CONTENT_TYPES: Record<SubtitleOutputFormat, string> = {
  vtt: 'text/vtt; charset=utf-8',
  srt: 'application/x-subrip; charset=utf-8',
}

/**
 * Upstream subtitle hosts gate access on their own `Origin` allowlist and serve
 * SubRip as `application/octet-stream`, so their URLs cannot be handed to
 * clients directly. This route fetches, decodes and normalizes them instead.
 */
subtitlesRouter.get('/natsuki/:file', async (req: Request, res: Response) => {
  const rawFile = Array.isArray(req.params.file)
    ? req.params.file[0]
    : req.params.file
  const match = /^(\d+)\.(vtt|srt)$/i.exec((rawFile || '').trim())

  if (!match) {
    res.status(400).json({
      success: false,
      error: 'Invalid subtitle file',
      details:
        'Expected a path of the form /natsuki/{id}.vtt or /natsuki/{id}.srt',
    })
    return
  }

  const sid = match[1]
  const format = match[2].toLowerCase() as SubtitleOutputFormat
  const language = languageHint(req.query.l)
  const cacheKey = `flixquest:provider:subs:natsuki:file:${sid}:${format}`

  try {
    const cached = await getProviderCache<string>(cacheKey)
    if (cached) {
      sendSubtitle(res, cached, format, 'HIT')
      return
    }

    const raw = await fetchNatsukiSubtitleFile(sid, language)
    const converted = convertSubtitle(raw, format)

    await setProviderCache(cacheKey, converted, CACHE_TTL_SECONDS)
    sendSubtitle(res, converted, format, 'MISS')
  } catch (error) {
    console.warn(
      `[Subtitles] natsuki/${sid}: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    )
    res.status(502).json({
      success: false,
      error: 'Failed to fetch subtitle file',
      details: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

function languageHint(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return /^[a-z]{2,3}(?:-[a-z]{2,4})?$/.test(raw) ? raw : undefined
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
