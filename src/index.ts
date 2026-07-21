import 'dotenv/config'
import express from 'express'
import type { Request, Response } from 'express'
import { generateMovieMedia, generateShowMedia } from './utils/tmdb.js'
import {
  getProvider,
  getAllProviderIds,
  getAllProviders,
} from './providers/index.js'
import type { ErrorResponse, ProviderResponse } from './types/index.js'
import { handleStreamProxy, proxyStreamLinks } from './utils/stream-proxy.js'

const app = express()
const api = express.Router()
const port = parseInt(process.env.PORT || '3000', 10)
const API_PREFIX = '/v2'

app.set('trust proxy', 1)
app.use(express.json())

app.get('/proxy', handleStreamProxy)
app.head('/proxy', handleStreamProxy)

function proxyBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get('host')}`
}

function shouldProxy(req: Request): boolean {
  return getQueryString(req.query.proxy)?.toLowerCase() !== 'false'
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

  const provider = getProvider(providerId)
  if (!provider) {
    const error: ErrorResponse = {
      success: false,
      error: `Provider '${providerId}' not found`,
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
      streamMovie: 'GET /v2/stream-movie?tmdbId={id}&provider={providerId}',
      streamTV:
        'GET /v2/stream-tv?tmdbId={id}&season={num}&episode={num}&provider={providerId}',
      providers: 'GET /v2/providers',
      proxy: 'GET /proxy?token={signedToken}',
    },
    availableProviders: getAllProviderIds(),
  })
})

api.get('/providers', (_req, res) => {
  const providerList = getAllProviders().map(provider => ({
    id: provider.id,
    name: provider.name,
  }))
  res.json({ success: true, providers: providerList })
})

/**
 * GET /v2/stream-movie?tmdbId=556574&provider=vixsrc
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

    const links = await provider.streamMovie(tmdbId)
    if (links.length === 0) {
      const error: ErrorResponse = {
        success: false,
        error: 'No streams found for this movie',
      }
      res.status(404).json(error)
      return
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
      links: shouldProxy(req)
        ? proxyStreamLinks(links, proxyBaseUrl(req))
        : links,
    }

    console.log(`✅ [${provider.name}] Found ${links.length} stream(s)`)
    res.json(response)
  } catch (err) {
    console.error('❌ Error in /v2/stream-movie:', err)
    const error: ErrorResponse = {
      success: false,
      error: 'Failed to fetch movie stream',
      details: err instanceof Error ? err.message : 'Unknown error',
    }
    res.status(500).json(error)
  }
})

/**
 * GET /v2/stream-tv?tmdbId=2316&season=1&episode=1&provider=vixsrc
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

    const links = await provider.streamTV(tmdbId, season, episode)
    if (links.length === 0) {
      const error: ErrorResponse = {
        success: false,
        error: 'No streams found for this episode',
      }
      res.status(404).json(error)
      return
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
      links: shouldProxy(req)
        ? proxyStreamLinks(links, proxyBaseUrl(req))
        : links,
    }

    console.log(`✅ [${provider.name}] Found ${links.length} stream(s)`)
    res.json(response)
  } catch (err) {
    console.error('❌ Error in /v2/stream-tv:', err)
    const error: ErrorResponse = {
      success: false,
      error: 'Failed to fetch TV show stream',
      details: err instanceof Error ? err.message : 'Unknown error',
    }
    res.status(500).json(error)
  }
})

app.use(API_PREFIX, api)

if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`🚀 FlixQuest Scraper API running at http://localhost:${port}`)
    console.log('📖 API v2:')
    console.log('   GET /v2/stream-movie?tmdbId={id}&provider={providerId}')
    console.log(
      '   GET /v2/stream-tv?tmdbId={id}&season={num}&episode={num}&provider={providerId}'
    )
    console.log('   GET /v2/providers')
    console.log('')
    console.log('⚠️  Make sure to set TMDB_API_KEY environment variable')
  })
}

export default app
