import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import { NotFoundError } from "@p-stream/providers";
import { generateMovieMedia, generateShowMedia } from "./utils/tmdb";
import { buildProviders } from "./utils/providers";
import type { StreamResponse, ErrorResponse } from "./types/index";

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Health check endpoint
app.get("/", (_req, res) => {
  res.json({
    name: "FlixQuest Scraper API",
    version: "1.0.0",
    status: "running",
    endpoints: {
      streamMovie: "GET /stream-movie?tmdbId={id}",
      streamTV: "GET /stream-tv?tmdbId={id}&season={num}&episode={num}",
      sources: "GET /sources",
      embeds: "GET /embeds",
    },
  });
});

/**
 * Stream movie endpoint
 * GET /stream-movie?tmdbId=556574
 */
app.get("/stream-movie", async (req: Request, res: Response) => {
  try {
    const { tmdbId } = req.query;

    if (!tmdbId || typeof tmdbId !== "string") {
      const error: ErrorResponse = {
        success: false,
        error: "Missing or invalid tmdbId parameter",
      };
      return res.status(400).json(error);
    }

    console.log(`🎬 Fetching movie metadata for TMDB ID: ${tmdbId}`);

    // Generate media object from TMDB
    const media = await generateMovieMedia(tmdbId);

    console.log(
      `📺 Scraping streams for: ${media.title} (${media.releaseYear})`
    );

    // Get providers and run scraping
    const providers = buildProviders();
    const output = await providers.runAll({ media });

    if (!output) {
      const error: ErrorResponse = {
        success: false,
        error: "No streams found for this movie",
      };
      return res.status(404).json(error);
    }

    console.log(`✅ Stream found from source: ${output.sourceId}`);

    const response: StreamResponse = {
      success: true,
      media: {
        type: media.type,
        title: media.title,
        releaseYear: media.releaseYear,
        tmdbId: media.tmdbId,
      },
      stream: {
        sourceId: output.sourceId,
        embedId: output.embedId,
        type: output.stream.type,
        id: output.stream.id,
        ...(output.stream.type === "hls" && {
          playlist: output.stream.playlist,
        }),
        ...(output.stream.type === "file" && {
          qualities: output.stream.qualities,
        }),
        flags: output.stream.flags,
        captions: output.stream.captions,
        headers: output.stream.headers,
        preferredHeaders: output.stream.preferredHeaders,
      },
    };

    res.json(response);
  } catch (err) {
    console.error("❌ Error in /stream-movie:", err);

    if (err instanceof NotFoundError) {
      const error: ErrorResponse = {
        success: false,
        error: "Movie not found on any source",
        details: err.message,
      };
      return res.status(404).json(error);
    }

    const error: ErrorResponse = {
      success: false,
      error: "Failed to fetch movie stream",
      details: err instanceof Error ? err.message : "Unknown error",
    };
    res.status(500).json(error);
  }
});

/**
 * Stream TV show endpoint
 * GET /stream-tv?tmdbId=2316&season=1&episode=1
 */
app.get("/stream-tv", async (req: Request, res: Response) => {
  try {
    const { tmdbId, season, episode } = req.query;

    if (!tmdbId || typeof tmdbId !== "string") {
      const error: ErrorResponse = {
        success: false,
        error: "Missing or invalid tmdbId parameter",
      };
      return res.status(400).json(error);
    }

    const seasonNum = parseInt(season as string);
    const episodeNum = parseInt(episode as string);

    if (isNaN(seasonNum) || isNaN(episodeNum)) {
      const error: ErrorResponse = {
        success: false,
        error: "Missing or invalid season/episode parameters",
      };
      return res.status(400).json(error);
    }

    console.log(
      `🎬 Fetching TV show metadata for TMDB ID: ${tmdbId} S${seasonNum}E${episodeNum}`
    );

    // Generate media object from TMDB
    const media = await generateShowMedia(tmdbId, seasonNum, episodeNum);

    console.log(
      `📺 Scraping streams for: ${media.title} (${media.releaseYear}) - S${seasonNum}E${episodeNum}`
    );

    // Get providers and run scraping
    const providers = buildProviders();
    const output = await providers.runAll({ media });

    if (!output) {
      const error: ErrorResponse = {
        success: false,
        error: "No streams found for this episode",
      };
      return res.status(404).json(error);
    }

    console.log(`✅ Stream found from source: ${output.sourceId}`);

    const response: StreamResponse = {
      success: true,
      media: {
        type: media.type,
        title: `${media.title} - S${media.season.number}E${media.episode.number}`,
        releaseYear: media.releaseYear,
        tmdbId: media.tmdbId,
      },
      stream: {
        sourceId: output.sourceId,
        embedId: output.embedId,
        type: output.stream.type,
        id: output.stream.id,
        ...(output.stream.type === "hls" && {
          playlist: output.stream.playlist,
        }),
        ...(output.stream.type === "file" && {
          qualities: output.stream.qualities,
        }),
        flags: output.stream.flags,
        captions: output.stream.captions,
        headers: output.stream.headers,
        preferredHeaders: output.stream.preferredHeaders,
      },
    };

    res.json(response);
  } catch (err) {
    console.error("❌ Error in /stream-tv:", err);

    if (err instanceof NotFoundError) {
      const error: ErrorResponse = {
        success: false,
        error: "TV show episode not found on any source",
        details: err.message,
      };
      return res.status(404).json(error);
    }

    const error: ErrorResponse = {
      success: false,
      error: "Failed to fetch TV show stream",
      details: err instanceof Error ? err.message : "Unknown error",
    };
    res.status(500).json(error);
  }
});

/**
 * List available sources
 * GET /sources
 */
app.get("/sources", (_req, res) => {
  const providers = buildProviders();
  const sources = providers.listSources();
  res.json({ success: true, sources });
});

/**
 * List available embeds
 * GET /embeds
 */
app.get("/embeds", (_req, res) => {
  const providers = buildProviders();
  const embeds = providers.listEmbeds();
  res.json({ success: true, embeds });
});

// Start server
app.listen(port, () => {
  console.log(`🚀 FlixQuest Scraper API running at http://localhost:${port}`);
  console.log(`📖 API Documentation:`);
  console.log(`   GET /stream-movie?tmdbId={id}`);
  console.log(`   GET /stream-tv?tmdbId={id}&season={num}&episode={num}`);
  console.log(`   GET /sources`);
  console.log(`   GET /embeds`);
  console.log("");
  console.log(`⚠️  Make sure to set TMDB_API_KEY environment variable`);
});
