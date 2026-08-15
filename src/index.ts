import 'dotenv/config'
import { spawn, type ChildProcess } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import type { Request, Response } from 'express'
import { generateMovieMedia, generateShowMedia } from './utils/tmdb.js'
import {
  getAllProviderIds,
  getAllProviders,
  getRawProvider,
  isProviderEnabled,
  setProviderEnabled,
} from './providers/index.js'
import type {
  ErrorResponse,
  ProviderLink,
  ProviderResponse,
} from './types/index.js'
import { validateStreamLinks } from './utils/stream-validation.js'
import {
  forwardProxyStorage,
  setupForwardProxyPatch,
} from './utils/forward-proxy.js'
import { fetchWyzieSubtitles } from './utils/wyzie-subs.js'
import {
  buildProviderCacheKey,
  flushProviderCache,
  getCacheStats,
  getProviderCache,
  setProviderCache,
  setProviderStatus,
} from './utils/redis.js'
import { dlhdRouter } from './routes/dlhd.js'
import { resolveIntroConfig } from './utils/intro-config.js'
import {
  providerStatusFile,
  readProviderStatus,
} from './utils/provider-status.js'
import { runProviderHealthCheck } from '../scripts/provider-health-monitor.mjs'

setupForwardProxyPatch()

const app = express()
const api = express.Router()
const port = parseInt(process.env.PORT || '3000', 10)
const API_PREFIX = '/api/v2'

// Providers whose responses contain short-lived or session-bound URLs must
// not be cached for the default two-hour Redis TTL:
// - vidsrc: stream hosts issue IP-bound tokens that expire quickly.
// - vidup: the en config, server list and CSRF token rotate on every page
//   load; resolved stream endpoints are session-bound.
// - vidnest: several servers return signed URLs with expiry parameters
//   (moviebox sign/t, beta t/s/e, alfa ?v=).
// - aether: several workers (link, meridian, nebula, lul) hand out signed
//   or tokenized stream URLs that can expire within the cache window.
// - artemis: Celestial stream URLs are returned by a short-lived catalog
//   lookup and can expire independently of the two-hour cache TTL.
// - zstream: Neko/Shibuya/Vault hand out short-lived tokenized stream URLs.
// - vidfast: the protected server tokens and resolved CDN URLs are session-bound.
const UNCACHEABLE_PROVIDER_IDS = new Set([
  'vidsrc',
  'vidup',
  'vidnest',
  'aether',
  'artemis',
  'zstream',
  'vidfast',
])

app.set('trust proxy', 1)
app.use(express.json())

app.use((req, _res, next) => {
  const fProxyQuery = req.query.fProxy || req.query.forwardProxy
  const fProxyStr = typeof fProxyQuery === 'string' ? fProxyQuery.trim() : ''
  const providerId =
    typeof req.query.provider === 'string'
      ? req.query.provider.trim().toLowerCase()
      : ''
  const providerRequiresFProxy =
    providerId === 'vixsrc' || providerId === 'videasy'

  const fProxyEnabled =
    providerRequiresFProxy ||
    fProxyQuery === 'true' ||
    fProxyQuery === '1' ||
    fProxyStr.toLowerCase() === 'true' ||
    fProxyStr.startsWith('http')

  const proxyUrl = fProxyStr.startsWith('http') ? fProxyStr : undefined

  forwardProxyStorage.run({ fProxyEnabled, proxyUrl }, () => {
    next()
  })
})

function unwrapInnerProxyUrl(url: string): string {
  let currentUrl = url

  for (let depth = 0; depth < 5; depth++) {
    try {
      const parsed = new URL(currentUrl)
      const innerUrl =
        parsed.searchParams.get('url') ||
        parsed.searchParams.get('destination') ||
        parsed.searchParams.get('src')

      if (
        !innerUrl ||
        !/^https?:\/\//i.test(innerUrl) ||
        innerUrl === currentUrl
      ) {
        break
      }
      currentUrl = innerUrl
    } catch {
      break
    }
  }

  return currentUrl
}

function unproxyStreamLink(link: ProviderLink): ProviderLink {
  return {
    ...link,
    url: unwrapInnerProxyUrl(link.url),
    hlsVariant: link.hlsVariant
      ? unwrapInnerProxyUrl(link.hlsVariant)
      : undefined,
    subtitles: link.subtitles.map(subtitle => ({
      ...subtitle,
      file: unwrapInnerProxyUrl(subtitle.file),
    })),
    requiresProxy: false,
  }
}

async function responseStreamLinks(
  links: ProviderLink[]
): Promise<ProviderLink[]> {
  const processedLinks = links.map(link => unproxyStreamLink(link))
  const validatedLinks = await validateStreamLinks(processedLinks)
  return validatedLinks.map(link => unproxyStreamLink(link))
}

function getQueryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parsePositiveInteger(value: unknown): number | undefined {
  const stringValue = getQueryString(value)
  if (!stringValue || !/^\d+$/.test(stringValue)) return undefined

  const numberValue = Number(stringValue)
  return Number.isSafeInteger(numberValue) && numberValue > 0
    ? numberValue
    : undefined
}

function shouldBypassCache(req: Request): boolean {
  const skipQuery =
    getQueryString(req.query.skipCache)?.toLowerCase() ||
    getQueryString(req.query.nocache)?.toLowerCase() ||
    getQueryString(req.query.refresh)?.toLowerCase()

  const headerBypass = req.headers['x-cache-bypass']

  return (
    skipQuery === 'true' ||
    skipQuery === '1' ||
    headerBypass === 'true' ||
    headerBypass === '1'
  )
}

function resolveProvider(req: Request, res: Response) {
  const providerId = getQueryString(req.query.provider)

  if (!providerId) {
    const error: ErrorResponse = {
      success: false,
      error: 'Missing or invalid provider parameter',
      details: `Available providers: ${getAllProviderIds().join(', ')}`,
    }
    res.status(400).json(error)
    return undefined
  }

  const provider = getRawProvider(providerId)
  if (!provider) {
    const error: ErrorResponse = {
      success: false,
      error: `Provider '${providerId}' not found or disabled`,
      details: `Available providers: ${getAllProviderIds().join(', ')}`,
    }
    res.status(404).json(error)
    return undefined
  }

  return provider
}

app.get('/', async (_req, res) => {
  const cacheStats = await getCacheStats()
  res.json({
    name: 'FlixQuest Scraper API',
    version: '2.0.0',
    status: 'running',
    endpoints: {
      streamMovie: 'GET /api/v2/stream-movie?tmdbId={id}&provider={providerId}',
      streamTV:
        'GET /api/v2/stream-tv?tmdbId={id}&season={num}&episode={num}&provider={providerId}',
      providers: 'GET /api/v2/providers',
      providerStatus: 'GET /api/v2/providers/status',
      healthRun: 'GET /api/v2/providers/health/run',
      intro: 'GET /api/v2/intro',
      toggleProvider:
        'PATCH /api/v2/providers/:id or POST /api/v2/providers/:id/toggle',
      cacheStats: 'GET /api/v2/cache/stats',
      cacheFlush: 'POST /api/v2/cache/flush',
      dlhdChannels: 'GET /api/v2/dlhd/channels',
      dlhdStream: 'GET /api/v2/dlhd/channels/{id}/stream',
      dlhdEpg: 'GET /api/v2/dlhd/epg',
    },
    redisCache: cacheStats.connected
      ? 'connected'
      : cacheStats.enabled
        ? 'disconnected'
        : 'disabled',
    availableProviders: getAllProviderIds(),
  })
})

api.get('/providers', (req: Request, res: Response) => {
  const includeDisabled =
    getQueryString(req.query.all)?.toLowerCase() === 'true' ||
    getQueryString(req.query.includeDisabled)?.toLowerCase() === 'true'

  const providerList = getAllProviders({ includeDisabled }).map(provider => ({
    id: provider.id,
    name: provider.name,
    alias: provider.alias || provider.name,
    content: provider.content || '',
    enabled: isProviderEnabled(provider.id),
  }))
  res.json({ success: true, providers: providerList })
})

api.get('/providers/status', async (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store')
  try {
    const stored = (await readProviderStatus()) as {
      success?: boolean
      startedAt?: string | null
      updatedAt?: string | null
      intervalMs?: number
      summary?: unknown
      providers?: unknown
    } | null
    if (!stored) {
      // No persisted status is available yet (e.g. a fresh Vercel serverless
      // deployment where the status file has not been written). Report the
      // provider registry as untested instead of failing the request.
      const fallback = getAllProviders({ includeDisabled: true }).map(
        provider => ({
          id: provider.id,
          alias: provider.alias || provider.name,
          status: 'untested',
          requestTimeMs: 0,
        })
      )
      res.json({
        success: true,
        updatedAt: null,
        intervalMs: 15 * 60 * 1000,
        summary: { total: fallback.length, online: 0, offline: 0 },
        providers: fallback,
      })
      return
    }
    const entries = Array.isArray(stored.providers)
      ? stored.providers
      : Object.values(stored.providers || {})
    const providers = entries.map(entry => {
      const item = entry as {
        id?: string
        provider?: string
        alias?: string
        status?: string
        requestTimeMs?: number
        responseTimeMs?: number
        attempts?: Array<{ elapsedMs?: number }>
      }
      const id = item.id || item.provider || ''
      const metadata = getRawProvider(id, { includeDisabled: true })
      return {
        id,
        alias: item.alias || metadata?.alias || metadata?.name || id,
        status: item.status || 'offline',
        requestTimeMs:
          item.requestTimeMs ??
          item.attempts?.reduce(
            (total, attempt) => total + (attempt.elapsedMs || 0),
            0
          ) ??
          item.responseTimeMs ??
          0,
      }
    })
    res.json({
      success: stored.success ?? true,
      updatedAt: stored.updatedAt ?? null,
      intervalMs: stored.intervalMs ?? 15 * 60 * 1000,
      summary: stored.summary,
      providers,
    })
  } catch (error) {
    const response: ErrorResponse = {
      success: false,
      error: 'Provider status is not available yet',
      details: error instanceof Error ? error.message : 'Unknown error',
    }
    res.status(503).json(response)
  }
})

/**
 * GET /api/v2/providers/health/run
 *
 * Runs a provider health check on demand and stores the fresh snapshot in
 * Redis. This is the endpoint Vercel Cron invokes every fifteen minutes;
 * the check is also exposed directly so it can be triggered from a
 * standalone cron on other platforms. Requires the `CRON_SECRET` query
 * parameter unless the request comes from Vercel Cron itself.
 */
api.get('/providers/health/run', async (req: Request, res: Response) => {
  const secret = process.env.CRON_SECRET
  const fromVercelCron =
    req.headers['user-agent']?.startsWith('vercel-cron/') === true ||
    typeof req.headers['x-vercel-cron-schedule'] === 'string' ||
    req.headers['x-vercel-cron'] === '1'
  const authorized =
    (fromVercelCron &&
      (!secret || req.headers['x-vercel-cron-auth'] === secret)) ||
    (secret && req.query.cronSecret === secret) ||
    (!secret && process.env.VERCEL !== '1')
  if (!authorized) {
    res.status(401).json({ success: false, error: 'Unauthorized' })
    return
  }

  const baseUrl = (
    process.env.PROVIDER_HEALTH_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
    `${req.protocol}://${req.get('host')}`
  ).replace(/\/$/, '')
  const outputFile = path.join(os.tmpdir(), 'provider-status.json')

  try {
    const status = await runProviderHealthCheck({
      baseUrl,
      outputFile,
      concurrency: Number(process.env.PROVIDER_HEALTH_CONCURRENCY) || undefined,
      timeoutMs: Number(process.env.PROVIDER_HEALTH_TIMEOUT_MS) || undefined,
      matrixMode: process.env.PROVIDER_HEALTH_MATRIX || undefined,
    })
    await setProviderStatus(status)
    res.json(status)
  } catch (error) {
    const response: ErrorResponse = {
      success: false,
      error: 'Provider health check failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }
    res.status(500).json(response)
  }
})

/**
 * GET /api/v2/intro
 *
 * Returns the current branded intro configuration. Playback clients must
 * fail open when the intro is disabled or temporarily unavailable so this
 * optional branding can never prevent the requested stream from starting.
 */
api.get('/intro', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store')
  try {
    res.json({ success: true, intro: resolveIntroConfig() })
  } catch (error) {
    const response: ErrorResponse = {
      success: false,
      error: 'Invalid branded intro configuration',
      details: error instanceof Error ? error.message : 'Unknown error',
    }
    res.status(500).json(response)
  }
})

/**
 * PATCH /api/v2/providers/:id
 * Body: { "enabled": true | false }
 */
api.patch('/providers/:id', (req: Request, res: Response) => {
  const providerId = Array.isArray(req.params.id)
    ? req.params.id[0]
    : req.params.id
  const { enabled } = req.body

  if (typeof enabled !== 'boolean') {
    const error: ErrorResponse = {
      success: false,
      error: "Missing or invalid 'enabled' boolean field in request body",
    }
    res.status(400).json(error)
    return
  }

  const success = setProviderEnabled(providerId, enabled)
  if (!success) {
    const error: ErrorResponse = {
      success: false,
      error: `Provider '${providerId}' not found`,
    }
    res.status(404).json(error)
    return
  }

  const provider = getRawProvider(providerId, { includeDisabled: true })
  res.json({
    success: true,
    message: `Provider '${providerId}' has been ${enabled ? 'enabled' : 'disabled'}`,
    provider: {
      id: provider!.id,
      name: provider!.name,
      alias: provider!.alias || provider!.name,
      content: provider!.content || '',
      enabled,
    },
  })
})

/**
 * POST /api/v2/providers/:id/toggle
 * Body (optional): { "enabled": true | false }
 */
api.post('/providers/:id/toggle', (req: Request, res: Response) => {
  const providerId = Array.isArray(req.params.id)
    ? req.params.id[0]
    : req.params.id
  let enabled: boolean

  if (typeof req.body?.enabled === 'boolean') {
    enabled = req.body.enabled
  } else {
    enabled = !isProviderEnabled(providerId)
  }

  const success = setProviderEnabled(providerId, enabled)
  if (!success) {
    const error: ErrorResponse = {
      success: false,
      error: `Provider '${providerId}' not found`,
    }
    res.status(404).json(error)
    return
  }

  const provider = getRawProvider(providerId, { includeDisabled: true })
  res.json({
    success: true,
    message: `Provider '${providerId}' has been ${enabled ? 'enabled' : 'disabled'}`,
    provider: {
      id: provider!.id,
      name: provider!.name,
      alias: provider!.alias || provider!.name,
      content: provider!.content || '',
      enabled,
    },
  })
})

/**
 * GET /api/v2/cache/stats
 */
api.get('/cache/stats', async (_req: Request, res: Response) => {
  const stats = await getCacheStats()
  res.json({
    success: true,
    cache: stats,
  })
})

/**
 * POST /api/v2/cache/flush
 */
api.post('/cache/flush', async (_req: Request, res: Response) => {
  const clearedCount = await flushProviderCache()
  res.json({
    success: true,
    message: `Flushed ${clearedCount} cached provider item(s)`,
    clearedCount,
  })
})

api.use('/dlhd', dlhdRouter)

/**
 * GET /api/v2/stream-movie?tmdbId=556574&provider=vixsrc
 */
api.get('/stream-movie', async (req: Request, res: Response) => {
  const provider = resolveProvider(req, res)
  if (!provider) return

  const tmdbId = getQueryString(req.query.tmdbId)
  if (!tmdbId) {
    const error: ErrorResponse = {
      success: false,
      error: 'Missing or invalid tmdbId parameter',
    }
    res.status(400).json(error)
    return
  }

  const bypass = shouldBypassCache(req)
  // Some providers issue short-lived, IP-bound or session-bound tokens.
  // Caching complete responses would outlive those tokens and turn cache
  // hits into dead links.
  const useProviderCache = !bypass && !UNCACHEABLE_PROVIDER_IDS.has(provider.id)
  const fProxyContext = forwardProxyStorage.getStore()
  const cacheKey = buildProviderCacheKey({
    providerId: provider.id,
    mediaType: 'movie',
    tmdbId,
    fProxyEnabled: fProxyContext?.fProxyEnabled,
    proxyUrl: fProxyContext?.proxyUrl,
  })

  if (useProviderCache) {
    const cachedResponse = await getProviderCache<ProviderResponse>(cacheKey)
    if (cachedResponse) {
      console.log(
        `⚡ [${provider.name}] Cache HIT for movie TMDB ID: ${tmdbId}`
      )
      res.setHeader('X-Cache', 'HIT')
      res.json(cachedResponse)
      return
    }
  }

  res.setHeader('X-Cache', useProviderCache ? 'MISS' : 'BYPASS')

  try {
    console.log(
      `🎬 [${provider.name}] Fetching movie streams for TMDB ID: ${tmdbId}`
    )

    const media = await generateMovieMedia(tmdbId)
    console.log(
      `📺 [${provider.name}] Scraping streams for: ${media.title} (${media.releaseYear})`
    )

    const candidates = await provider.streamMovie(tmdbId)
    if (candidates.length === 0) {
      const error: ErrorResponse = {
        success: false,
        error: 'No streams found for this movie',
      }
      res.status(404).json(error)
      return
    }

    const links = await responseStreamLinks(candidates)
    if (links.length === 0) {
      console.log(
        `[${provider.name}] Final URL validation kept 0/${candidates.length} candidate(s)`
      )
      const error: ErrorResponse = {
        success: false,
        error: 'No validated streams found for this movie',
      }
      res.status(404).json(error)
      return
    }
    if (links.length !== candidates.length) {
      console.log(
        `[${provider.name}] Final URL validation kept ${links.length}/${candidates.length} candidate(s)`
      )
    }

    // Wyzie Subs fallback: if no link has subtitles, fetch from Wyzie
    const hasAnySubtitles = links.some(link => link.subtitles.length > 0)
    if (!hasAnySubtitles) {
      const wyzieSubs = await fetchWyzieSubtitles(tmdbId)
      if (wyzieSubs.length > 0) {
        console.log(
          `🔤 [${provider.name}] Injecting ${wyzieSubs.length} Wyzie subtitle(s) as fallback`
        )
        for (const link of links) {
          link.subtitles = wyzieSubs
        }
      }
    }

    const response: ProviderResponse = {
      success: true,
      provider: provider.id,
      media: {
        type: media.type,
        title: media.title,
        releaseYear: media.releaseYear,
        tmdbId: media.tmdbId,
      },
      links,
    }

    console.log(`✅ [${provider.name}] Found ${links.length} stream(s)`)

    if (useProviderCache && response.links && response.links.length > 0) {
      setProviderCache(cacheKey, response)
    }

    res.json(response)
  } catch (err) {
    console.error('❌ Error in /api/v2/stream-movie:', err)
    const error: ErrorResponse = {
      success: false,
      error: 'Failed to fetch movie stream',
      details: err instanceof Error ? err.message : 'Unknown error',
    }
    res.status(500).json(error)
  }
})

/**
 * GET /api/v2/stream-tv?tmdbId=2316&season=1&episode=1&provider=vixsrc
 */
api.get('/stream-tv', async (req: Request, res: Response) => {
  const provider = resolveProvider(req, res)
  if (!provider) return

  const tmdbId = getQueryString(req.query.tmdbId)
  const season = parsePositiveInteger(req.query.season)
  const episode = parsePositiveInteger(req.query.episode)

  if (!tmdbId) {
    const error: ErrorResponse = {
      success: false,
      error: 'Missing or invalid tmdbId parameter',
    }
    res.status(400).json(error)
    return
  }

  if (!season || !episode) {
    const error: ErrorResponse = {
      success: false,
      error: 'Missing or invalid season/episode parameters',
    }
    res.status(400).json(error)
    return
  }

  const bypass = shouldBypassCache(req)
  const useProviderCache = !bypass && !UNCACHEABLE_PROVIDER_IDS.has(provider.id)
  const fProxyContext = forwardProxyStorage.getStore()
  const cacheKey = buildProviderCacheKey({
    providerId: provider.id,
    mediaType: 'tv',
    tmdbId,
    season,
    episode,
    fProxyEnabled: fProxyContext?.fProxyEnabled,
    proxyUrl: fProxyContext?.proxyUrl,
  })

  if (useProviderCache) {
    const cachedResponse = await getProviderCache<ProviderResponse>(cacheKey)
    if (cachedResponse) {
      console.log(
        `⚡ [${provider.name}] Cache HIT for TV TMDB ID: ${tmdbId} S${season}E${episode}`
      )
      res.setHeader('X-Cache', 'HIT')
      res.json(cachedResponse)
      return
    }
  }

  res.setHeader('X-Cache', useProviderCache ? 'MISS' : 'BYPASS')

  try {
    console.log(
      `🎬 [${provider.name}] Fetching TV streams for TMDB ID: ${tmdbId} S${season}E${episode}`
    )

    const media = await generateShowMedia(tmdbId, season, episode)
    console.log(
      `📺 [${provider.name}] Scraping streams for: ${media.title} (${media.releaseYear}) - S${season}E${episode}`
    )

    const candidates = await provider.streamTV(tmdbId, season, episode)
    if (candidates.length === 0) {
      const error: ErrorResponse = {
        success: false,
        error: 'No streams found for this episode',
      }
      res.status(404).json(error)
      return
    }

    const links = await responseStreamLinks(candidates)
    if (links.length === 0) {
      console.log(
        `[${provider.name}] Final URL validation kept 0/${candidates.length} candidate(s)`
      )
      const error: ErrorResponse = {
        success: false,
        error: 'No validated streams found for this episode',
      }
      res.status(404).json(error)
      return
    }
    if (links.length !== candidates.length) {
      console.log(
        `[${provider.name}] Final URL validation kept ${links.length}/${candidates.length} candidate(s)`
      )
    }

    // Wyzie Subs fallback: if no link has subtitles, fetch from Wyzie
    const hasAnySubtitles = links.some(link => link.subtitles.length > 0)
    if (!hasAnySubtitles) {
      const wyzieSubs = await fetchWyzieSubtitles(tmdbId, season, episode)
      if (wyzieSubs.length > 0) {
        console.log(
          `🔤 [${provider.name}] Injecting ${wyzieSubs.length} Wyzie subtitle(s) as fallback`
        )
        for (const link of links) {
          link.subtitles = wyzieSubs
        }
      }
    }

    const response: ProviderResponse = {
      success: true,
      provider: provider.id,
      media: {
        type: media.type,
        title: `${media.title} - S${media.season.number}E${media.episode.number}`,
        releaseYear: media.releaseYear,
        tmdbId: media.tmdbId,
      },
      links,
    }

    console.log(`✅ [${provider.name}] Found ${links.length} stream(s)`)

    if (useProviderCache && response.links && response.links.length > 0) {
      setProviderCache(cacheKey, response)
    }

    res.json(response)
  } catch (err) {
    console.error('❌ Error in /api/v2/stream-tv:', err)
    const error: ErrorResponse = {
      success: false,
      error: 'Failed to fetch TV show stream',
      details: err instanceof Error ? err.message : 'Unknown error',
    }
    res.status(500).json(error)
  }
})

app.use(API_PREFIX, api)

let providerHealthMonitor: ChildProcess | undefined

const server = app.listen(port, () => {
  console.log(`🚀 FlixQuest Scraper API running at http://localhost:${port}`)
  if (process.env.NODE_ENV !== 'production') {
    console.log('📖 API v2:')
    console.log('   GET /api/v2/stream-movie?tmdbId={id}&provider={providerId}')
    console.log(
      '   GET /api/v2/stream-tv?tmdbId={id}&season={num}&episode={num}&provider={providerId}'
    )
    console.log('   GET /api/v2/providers')
    console.log('   GET /api/v2/providers/status')
    console.log('   GET /api/v2/intro')
    console.log('   GET /api/v2/dlhd/channels')
    console.log('   GET /api/v2/dlhd/channels/{id}/stream')
    console.log('   GET /api/v2/dlhd/epg')
    console.log('')
    console.log('⚠️  Make sure to set TMDB_API_KEY environment variable')
  }

  // On Vercel serverless, background child processes are frozen between
  // requests, so the interval monitor can never run. Vercel Cron drives
  // `/api/v2/providers/health/run` instead, which stores results in Redis.
  const isVercel = process.env.VERCEL === '1'
  if (!isVercel && process.env.PROVIDER_HEALTH_MONITOR_ENABLED !== 'false') {
    providerHealthMonitor = spawn(
      process.execPath,
      ['scripts/provider-health-monitor.mjs'],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          PROVIDER_HEALTH_BASE_URL:
            process.env.PROVIDER_HEALTH_BASE_URL || `http://127.0.0.1:${port}`,
          PROVIDER_STATUS_FILE: providerStatusFile,
        },
      }
    )
    providerHealthMonitor.on('exit', (code, signal) => {
      if (code && !signal) {
        console.error(`[ProviderHealth] Monitor exited with code ${code}`)
      }
    })
  }
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    providerHealthMonitor?.kill(signal)
    server.close(() => process.exit(0))
  })
}

export default app
