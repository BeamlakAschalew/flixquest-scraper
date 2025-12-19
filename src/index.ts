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

const app = express()
const port = parseInt(process.env.PORT || '3000', 10)

// Middleware to parse JSON bodies
app.use(express.json())

// Add CORS for cross-origin requests (optional, uncomment if needed)
// import cors from 'cors';
// app.use(cors());

// Health check endpoint
app.get('/', (_req, res) => {
  res.json({
    name: 'FlixQuest Scraper API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      streamMovie: 'GET /stream-movie?tmdbId={id}',
      streamTV: 'GET /stream-tv?tmdbId={id}&season={num}&episode={num}',
      providerStreamMovie: 'GET /:provider/stream-movie?tmdbId={id}',
      providerStreamTV:
        'GET /:provider/stream-tv?tmdbId={id}&season={num}&episode={num}',
      providers: 'GET /providers',
      sources: 'GET /sources',
      embeds: 'GET /embeds',
    },
    availableProviders: getAllProviderIds(),
  })
})

/**
 * List available providers
 * GET /providers
 */
app.get('/providers', (_req, res) => {
  const providerList = getAllProviders().map(p => ({
    id: p.id,
    name: p.name,
  }))
  res.json({ success: true, providers: providerList })
})

/**
 * Provider-specific stream movie endpoint
 * GET /:provider/stream-movie?tmdbId=556574
 */
app.get('/:provider/stream-movie', async (req: Request, res: Response) => {
  try {
    const { provider: providerId } = req.params
    const { tmdbId } = req.query

    const provider = getProvider(providerId)

    if (!provider) {
      const error: ErrorResponse = {
        success: false,
        error: `Provider '${providerId}' not found`,
        details: `Available providers: ${getAllProviderIds().join(', ')}`,
      }
      return res.status(404).json(error)
    }

    if (!tmdbId || typeof tmdbId !== 'string') {
      const error: ErrorResponse = {
        success: false,
        error: 'Missing or invalid tmdbId parameter',
      }
      return res.status(400).json(error)
    }

    console.log(
      `🎬 [${provider.name}] Fetching movie streams for TMDB ID: ${tmdbId}`
    )

    // Generate media object from TMDB for metadata
    const media = await generateMovieMedia(tmdbId)

    console.log(
      `📺 [${provider.name}] Scraping streams for: ${media.title} (${media.releaseYear})`
    )

    const links = await provider.streamMovie(tmdbId)

    if (!links || links.length === 0) {
      const error: ErrorResponse = {
        success: false,
        error: 'No streams found for this movie',
      }
      return res.status(404).json(error)
    }

    console.log(`✅ [${provider.name}] Found ${links.length} stream(s)`)

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

    res.json(response)
  } catch (err) {
    console.error('❌ Error in /:provider/stream-movie:', err)

    const error: ErrorResponse = {
      success: false,
      error: 'Failed to fetch movie stream',
      details: err instanceof Error ? err.message : 'Unknown error',
    }
    res.status(500).json(error)
  }
})

/**
 * Provider-specific stream TV endpoint
 * GET /:provider/stream-tv?tmdbId=2316&season=1&episode=1
 */
app.get('/:provider/stream-tv', async (req: Request, res: Response) => {
  try {
    const { provider: providerId } = req.params
    const { tmdbId, season, episode } = req.query

    const provider = getProvider(providerId)

    if (!provider) {
      const error: ErrorResponse = {
        success: false,
        error: `Provider '${providerId}' not found`,
        details: `Available providers: ${getAllProviderIds().join(', ')}`,
      }
      return res.status(404).json(error)
    }

    if (!tmdbId || typeof tmdbId !== 'string') {
      const error: ErrorResponse = {
        success: false,
        error: 'Missing or invalid tmdbId parameter',
      }
      return res.status(400).json(error)
    }

    const seasonNum = parseInt(season as string)
    const episodeNum = parseInt(episode as string)

    if (isNaN(seasonNum) || isNaN(episodeNum)) {
      const error: ErrorResponse = {
        success: false,
        error: 'Missing or invalid season/episode parameters',
      }
      return res.status(400).json(error)
    }

    console.log(
      `🎬 [${provider.name}] Fetching TV streams for TMDB ID: ${tmdbId} S${seasonNum}E${episodeNum}`
    )

    // Generate media object from TMDB for metadata
    const media = await generateShowMedia(tmdbId, seasonNum, episodeNum)

    console.log(
      `📺 [${provider.name}] Scraping streams for: ${media.title} (${media.releaseYear}) - S${seasonNum}E${episodeNum}`
    )

    const links = await provider.streamTV(tmdbId, seasonNum, episodeNum)

    if (!links || links.length === 0) {
      const error: ErrorResponse = {
        success: false,
        error: 'No streams found for this episode',
      }
      return res.status(404).json(error)
    }

    console.log(`✅ [${provider.name}] Found ${links.length} stream(s)`)

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

    res.json(response)
  } catch (err) {
    console.error('❌ Error in /:provider/stream-tv:', err)

    const error: ErrorResponse = {
      success: false,
      error: 'Failed to fetch TV show stream',
      details: err instanceof Error ? err.message : 'Unknown error',
    }
    res.status(500).json(error)
  }
})

// Start server (only in development, not on Vercel)
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`🚀 FlixQuest Scraper API running at http://localhost:${port}`)
    console.log(`📖 API Documentation:`)
    console.log(`   GET /stream-movie?tmdbId={id}`)
    console.log(`   GET /stream-tv?tmdbId={id}&season={num}&episode={num}`)
    console.log(`   GET /sources`)
    console.log(`   GET /embeds`)
    console.log('')
    console.log(`⚠️  Make sure to set TMDB_API_KEY environment variable`)
  })
}

// Export the Express app for Vercel
export default app
