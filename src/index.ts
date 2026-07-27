import 'dotenv/config'
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
import { handleStreamProxy, proxyStreamLinks } from './utils/stream-proxy.js'
import { validateStreamLinks } from './utils/stream-validation.js'
import {
  forwardProxyStorage,
  setupForwardProxyPatch,
} from './utils/forward-proxy.js'

setupForwardProxyPatch()

const app = express()
const api = express.Router()
const port = parseInt(process.env.PORT || '3000', 10)
const API_PREFIX = '/api/v2'

app.set('trust proxy', 1)
app.use(express.json())

app.use((req, _res, next) => {
  const fProxyQuery = req.query.fProxy || req.query.forwardProxy
  const fProxyStr = typeof fProxyQuery === 'string' ? fProxyQuery.trim() : ''

  const fProxyEnabled =
    fProxyQuery === 'true' ||
    fProxyQuery === '1' ||
    fProxyStr.toLowerCase() === 'true' ||
    fProxyStr.startsWith('http')

  const proxyUrl = fProxyStr.startsWith('http') ? fProxyStr : undefined

  forwardProxyStorage.run({ fProxyEnabled, proxyUrl }, () => {
    next()
  })
})

app.get('/proxy', handleStreamProxy)
app.head('/proxy', handleStreamProxy)

function proxyBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get('host')}`
}

function isNoProxy(req: Request): boolean {
  const proxyQuery = getQueryString(req.query.proxy)?.toLowerCase()
  const noProxyQuery = getQueryString(req.query.noProxy)?.toLowerCase()

  return (
    noProxyQuery === 'true' ||
    noProxyQuery === '1' ||
    proxyQuery === 'false' ||
    proxyQuery === '0'
  )
}

function shouldProxy(req: Request): boolean {
  return getQueryString(req.query.proxy)?.toLowerCase() !== 'false'
}

function unwrapInnerProxyUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const innerUrl =
      parsed.searchParams.get('url') ||
      parsed.searchParams.get('destination') ||
      parsed.searchParams.get('src')

    if (innerUrl && /^https?:\/\//i.test(innerUrl)) {
      return innerUrl
    }
  } catch {
    // Return original string if URL parsing fails
  }
  return url
}

async function responseStreamLinks(
  req: Request,
  links: ProviderLink[]
): Promise<ProviderLink[]> {
  const bypassProxy = isNoProxy(req)
  const proxyAll = !bypassProxy && shouldProxy(req)
  const baseUrl = proxyBaseUrl(req)

  const processedLinks = links.map(link => {
    if (bypassProxy) {
      const rawUrl = unwrapInnerProxyUrl(link.url)
      return {
        ...link,
        url: rawUrl,
        requiresProxy: false,
      }
    }

    return proxyAll || link.requiresProxy
      ? proxyStreamLinks([link], baseUrl)[0]
      : link
  })

  return validateStreamLinks(processedLinks)
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

app.get('/', (_req, res) => {
  res.json({
    name: 'FlixQuest Scraper API',
    version: '2.0.0',
    status: 'running',
    endpoints: {
      streamMovie: 'GET /api/v2/stream-movie?tmdbId={id}&provider={providerId}',
      streamTV:
        'GET /api/v2/stream-tv?tmdbId={id}&season={num}&episode={num}&provider={providerId}',
      providers: 'GET /api/v2/providers',
      toggleProvider:
        'PATCH /api/v2/providers/:id or POST /api/v2/providers/:id/toggle',
      proxy: 'GET /proxy?token={signedToken}',
    },
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
    enabled: isProviderEnabled(provider.id),
  }))
  res.json({ success: true, providers: providerList })
})

/**
 * PATCH /api/v2/providers/:id
 * Body: { "enabled": true | false }
 */
api.patch('/providers/:id', (req: Request, res: Response) => {
  const providerId = req.params.id
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
      enabled,
    },
  })
})

/**
 * POST /api/v2/providers/:id/toggle
 * Body (optional): { "enabled": true | false }
 */
api.post('/providers/:id/toggle', (req: Request, res: Response) => {
  const providerId = req.params.id
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
      enabled,
    },
  })
})

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

    const links = await responseStreamLinks(req, candidates)
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

    const links = await responseStreamLinks(req, candidates)
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

app.listen(port, () => {
  console.log(`🚀 FlixQuest Scraper API running at http://localhost:${port}`)
  if (process.env.NODE_ENV !== 'production') {
    console.log('📖 API v2:')
    console.log('   GET /api/v2/stream-movie?tmdbId={id}&provider={providerId}')
    console.log(
      '   GET /api/v2/stream-tv?tmdbId={id}&season={num}&episode={num}&provider={providerId}'
    )
    console.log('   GET /api/v2/providers')
    console.log('')
    console.log('⚠️  Make sure to set TMDB_API_KEY environment variable')
  }
})

export default app
