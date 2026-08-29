# FlixQuest Scraper API

A powerful Express.js API for scraping streaming links for movies and TV shows using TMDB metadata. Supports multiple streaming providers with a modular, extensible architecture.

## Features

- 🎬 **Movie Streaming**: Get streaming links for movies using TMDB ID
- 📺 **TV Show Streaming**: Get streaming links for TV show episodes using TMDB ID, season, and episode number
- 📡 **Live TV and EPG**: Lists DLHD 24/7 channels, extracts live HLS streams with playback headers, and exposes the categorized schedule
- 🔍 **Automatic Metadata Fetching**: Automatically fetches movie/show metadata from TMDB API
- 🌐 **Multiple Providers**: Supports 33 streaming providers, including GOATED, Bingr, 4KHDHub, StreamFlix, Kisskh, ToonHub, Cuevana, UHDMovies, VidEasy, and NetMirror
- 🔌 **Modular Architecture**: Easy to add new providers
- 📝 **TypeScript**: Full TypeScript support with type definitions
- ⚡ **Fast**: Built with Express.js for high performance
- 🔗 **Direct stream links**: Responses contain raw provider URLs and never internal or forward-proxy URLs
- 🚀 **Deployment Ready**: Supports Vercel, Netlify, and Render deployments

## Prerequisites

- Node.js 22 or higher
- pnpm (or npm/yarn)
- TMDB API Key ([Get one here](https://www.themoviedb.org/settings/api))

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd flixquest-scraper
```

2. Install dependencies:

```bash
pnpm install
```

3. Create a `.env` file:

```bash
cp .env.example .env
```

4. Add your TMDB API key to `.env`:

```env
TMDB_API_KEY=your_actual_api_key_here
INTRO_VIDEO_URL=https://cdn.example.com/flixquest-intro.mp4
INTRO_VIDEO_ENABLED=true
STREAM_PROXY_SECRET=your_long_random_secret
PORT=3000
FEBBOX_COOKIE=your_febbox_cookir_for_showbox
SHOWBOX_PROXY_URL_VALUE=your_proxy_for_showbox
```

## Usage

### Development Mode

```bash
pnpm dev
```

### Production Build

```bash
pnpm build
pnpm start
```

## API Endpoints

### Provider health status

The API starts a background provider health monitor by default. Every fifteen
minutes it checks providers concurrently. Each provider tries the audit title
list sequentially until one title returns a validated stream; only providers
that exhaust all of their titles are marked offline.

```http
GET /api/v2/providers/status
```

Each provider entry contains only `id`, `alias`, `status`, and the total
`requestTimeMs` for its latest check.

Status is atomically persisted to `data/provider-status.json`. Set
`PROVIDER_STATUS_FILE` to a path on a persistent disk in production. Useful
settings are `PROVIDER_HEALTH_INTERVAL_MS`, `PROVIDER_HEALTH_CONCURRENCY`,
`PROVIDER_HEALTH_TIMEOUT_MS`, and `PROVIDER_HEALTH_MONITOR_ENABLED=false`.

Run a standalone check with `pnpm providers:health:once`, or run the standalone
fifteen-minute monitor with `pnpm providers:health`.

**Vercel:** serverless functions freeze between requests, so the background
monitor does not run. Instead `.github/workflows/provider-health.yml` runs a
GitHub Actions cron every fifteen minutes that calls
`GET /api/v2/providers/health/run`. The on-demand check writes its result to
Redis when `REDIS_URL`/`REDIS_HOST` is configured, and `/api/v2/providers/status`
reads from Redis first, then the file.

```http
GET /api/v2/providers/health/run
```

Set the workflow variables/secrets in GitHub:

- `PROVIDER_HEALTH_URL` — the production URL (e.g. `https://flixquest-scraper.vercel.app`).
- `CRON_SECRET` — must match the `CRON_SECRET` environment variable on Vercel;
  the workflow sends it as the `x-vercel-cron-auth` header. A manual trigger
  outside the workflow can pass `?cronSecret=<CRON_SECRET>`.

### 1. Health Check

Check API status and list available endpoints.

**Endpoint:** `GET /`

**Example:**

```bash
curl "http://localhost:3000/"
```

**Response:**

```json
{
  "name": "FlixQuest Scraper API",
  "version": "2.0.0",
  "status": "running",
  "endpoints": {
    "streamMovie": "GET /v2/stream-movie?tmdbId={id}&provider={providerId}",
    "streamTV": "GET /v2/stream-tv?tmdbId={id}&season={num}&episode={num}&provider={providerId}",
    "providers": "GET /v2/providers"
  },
  "availableProviders": [
    "vixsrc",
    "vidsrc",
    "vidzee",
    "uhdmovies",
    "showbox",
    "4khdhub",
    "4khdhubnew",
    "dahmermovies",
    "dahmermovies-tv",
    "streamflix",
    "videasy",
    "notorrent"
  ]
}
```

### 2. List Providers

Get all available streaming providers.

**Endpoint:** `GET /v2/providers`

**Example:**

```bash
curl "http://localhost:3000/v2/providers"
```

**Response:**

```json
{
  "success": true,
  "providers": [
    { "id": "vixsrc", "name": "Vixsrc" },
    { "id": "vidsrc", "name": "Vidsrc" },
    { "id": "vidzee", "name": "Vidzee" },
    { "id": "uhdmovies", "name": "UHDMovies" },
    { "id": "showbox", "name": "Showbox" },
    { "id": "4khdhub", "name": "4KHDHub" },
    { "id": "4khdhubnew", "name": "4KHDHub-NEW" },
    { "id": "dahmermovies", "name": "DahmerMovies" },
    { "id": "dahmermovies-tv", "name": "DahmerMovies-TV" },
    { "id": "streamflix", "name": "StreamFlix" },
    { "id": "videasy", "name": "VidEasy" },
    { "id": "notorrent", "name": "NoTorrent" }
  ]
}
```

### 3. Stream Movie

Get streaming links for a movie using TMDB ID from a specific provider.

**Endpoint:** `GET /v2/stream-movie`

**Query Parameters:**

- `tmdbId` (string, required): The TMDB ID of the movie
- `provider` (string, required): Provider ID returned by `GET /v2/providers`
- `full` (boolean, optional): Set `true` to exhaust every available server from the selected provider. Defaults to the first available server path.
- `proxy` (boolean, optional): Defaults to `true`; set `false` to receive validated upstream URLs directly.
- `noProxy` (boolean, optional): Set `true` (or `proxy=false`) to bypass both the API stream proxy (`requiresProxy`) and provider-level inner proxies, returning raw unproxied upstream URLs directly.

**Example:**

```bash
curl "http://localhost:3000/v2/stream-movie?tmdbId=556574&provider=vixsrc"
curl "http://localhost:3000/v2/stream-movie?tmdbId=556574&provider=vixsrc&full=true"
```

**Response:**

```json
{
  "success": true,
  "provider": "vixsrc",
  "media": {
    "type": "movie",
    "title": "Hamilton",
    "releaseYear": 2020,
    "tmdbId": "556574"
  },
  "links": [
    {
      "server": "Server 1",
      "url": "https://example.com/playlist.m3u8",
      "isM3U8": true,
      "quality": "1080p",
      "sizeToken": "eyJ1cmwiOiIuLi4ifQ.signed",
      "subtitles": [
        {
          "file": "https://example.com/subtitles.vtt",
          "label": "English",
          "kind": "captions",
          "default": true
        }
      ]
    }
  ]
}
```

Each returned stream link includes a short-lived `sizeToken` bound to its URL,
required request headers, selected quality, and forward-proxy context. To
measure the source bytes before starting a download, send only that token:

```bash
curl -X POST "http://localhost:3000/api/v2/stream-size" \
  -H "Content-Type: application/json" \
  -d '{"token":"eyJ1cmwiOiIuLi4ifQ.signed"}'
```

```json
{
  "success": true,
  "estimatedBytes": 1843928172,
  "confidence": "high",
  "method": "hls-average-bandwidth",
  "bitrate": 2400000,
  "format": "hls",
  "videoBytes": 1720000000,
  "audioBytes": 123928172,
  "initBytes": 0,
  "segmentCount": 842,
  "durationSeconds": 6412.5
}
```

For HLS, the normal path reads the selected variant's `AVERAGE-BANDWIDTH` (or
`BANDWIDTH`) and multiplies it by the total duration from the media playlist. If
a media playlist has `EXT-X-BITRATE` values, those are used as a fallback. When
none of that bitrate metadata exists, the estimator sends up to seven
distributed `Range: bytes=0-0` probes and uses the total sampled bytes divided
by the total sampled duration. At least three probes must succeed. It never
downloads a complete media segment for estimation. If range probing is not
supported, a low-confidence resolution-based estimate is returned when the
selected height is known.

A small allowance is included for the final MP4 container, and the endpoint has
a five-second ceiling. `high` means declared average or per-segment bitrate was
available; `medium` means peak `BANDWIDTH` or segment sampling was used; `low`
means only the selected resolution was available; `unknown` means no usable
estimate could be produced. This is a storage estimate, not a byte-perfect
prediction of the eventual Transformer output. Size tokens expire after 30
minutes.

### 4. Stream TV Show

Get streaming links for a TV show episode using TMDB ID, season, and episode number from a specific provider.

**Endpoint:** `GET /v2/stream-tv`

**Query Parameters:**

- `tmdbId` (string, required): The TMDB ID of the TV show
- `season` (number, required): Season number
- `episode` (number, required): Episode number
- `provider` (string, required): Provider ID returned by `GET /v2/providers`
- `full` (boolean, optional): Set `true` to exhaust every available server from the selected provider. Defaults to the first available server path.
- `proxy` (boolean, optional): Defaults to `true`; set `false` to receive validated upstream URLs directly. Anti-hotlink-protected streams remain proxied so browser playback does not fail with 403.

**Example:**

```bash
curl "http://localhost:3000/v2/stream-tv?tmdbId=2316&season=1&episode=1&provider=vixsrc"
curl "http://localhost:3000/v2/stream-tv?tmdbId=2316&season=1&episode=1&provider=vixsrc&full=true"
```

**Response:**

```json
{
  "success": true,
  "provider": "vixsrc",
  "media": {
    "type": "show",
    "title": "The Office - S1E1",
    "releaseYear": 2005,
    "tmdbId": "2316"
  },
  "links": [
    {
      "server": "Server 1",
      "url": "https://example.com/playlist.m3u8",
      "isM3U8": true,
      "quality": "1080p",
      "subtitles": [
        {
          "file": "https://example.com/subtitles.vtt",
          "label": "English",
          "kind": "captions",
          "default": true
        }
      ]
    }
  ]
}
```

Vixsrc and VidEasy discovery and validation, and may be enabled for other
providers, but its URL is removed from stream, HLS variant, and subtitle
results. TMDB metadata calls bypass `fProxy`. Clients should apply any `headers`
included with a link when requesting it.

### 5. DLHD Live Channels

List the current channels scraped from `https://dlhd.st/24-7-channels.php`.

**Endpoint:** `GET /api/v2/dlhd/channels`

Optional query parameters:

- `search` or `q`: Filter by channel name or ID.
- `refresh=true`: Bypass the 15-minute in-memory channel cache.

```bash
curl "http://localhost:3000/api/v2/dlhd/channels?search=ABC"
```

### 6. DLHD Channel Stream

Extract a fresh HLS master playlist for a numeric DLHD channel ID. The returned
`headers` must be sent with the master playlist, child playlists, and media
segments. Stream responses use `Cache-Control: no-store` because the URL token
is short-lived.

**Endpoint:** `GET /api/v2/dlhd/channels/{id}/stream`

The shorter alias `GET /api/v2/dlhd/stream/{id}` is also supported.

```bash
curl "http://localhost:3000/api/v2/dlhd/channels/51/stream"
```

```json
{
  "success": true,
  "source": "dlhd",
  "channel": { "id": "51", "name": "ABC USA" },
  "stream": {
    "url": "https://stream-host.example/secure/token/premium51/index.m3u8",
    "isM3U8": true,
    "headers": {
      "Accept": "*/*",
      "Origin": "https://player-host.example",
      "Referer": "https://player-host.example/",
      "User-Agent": "Mozilla/5.0 ..."
    },
    "embedUrl": "https://player-host.example/premiumtv/daddy3.php?id=51",
    "expiresAt": "2026-08-08T21:46:21.000Z"
  }
}
```

### 7. DLHD Categorized EPG

Return DLHD's schedule nested as `days -> categories -> events -> channels`.
Times are reported in the site's advertised `UK GMT` timezone.

**Endpoint:** `GET /api/v2/dlhd/epg`

Optional query parameters:

- `date=YYYY-MM-DD`: Select a schedule day.
- `category`: Case-insensitive category filter.
- `search` or `q`: Search event titles, times, and channel names.
- `refresh=true`: Bypass the five-minute in-memory EPG cache.

```bash
curl "http://localhost:3000/api/v2/dlhd/epg?category=PPV&date=2026-08-08"
```

### 8. Cache Stats

Check Redis caching layer connection health and key statistics.

**Endpoint:** `GET /api/v2/cache/stats`

**Response:**

```json
{
  "success": true,
  "cache": {
    "enabled": true,
    "connected": true,
    "defaultTtlSeconds": 7200,
    "providerKeysCount": 42
  }
}
```

### 9. Flush Provider Cache

Clear all cached provider stream responses.

**Endpoint:** `POST /api/v2/cache/flush`

**Response:**

```json
{
  "success": true,
  "message": "Flushed 42 cached provider item(s)",
  "clearedCount": 42
}
```

### 10. Subtitle File

Serves one fallback subtitle track. Clients never build these URLs themselves —
they arrive ready to use in `links[].subtitles[].file` whenever a provider
returned no subtitles of its own.

**Endpoint:** `GET /api/v2/subtitles/{provider}/{id}.{vtt|srt}`

**Example:** `GET /api/v2/subtitles/natsuki/3480430.vtt?l=en`

| Parameter  | Description                                                          |
| ---------- | -------------------------------------------------------------------- |
| `provider` | Fallback subtitle provider that owns the id (currently `natsuki`)     |
| `id`       | Provider-specific subtitle id                                        |
| `l`        | Optional ISO 639 hint used to decode non-UTF-8 uploads               |

Responds with `text/vtt` (or `application/x-subrip` for `.srt`), open CORS, and
a 24-hour cache. Aggregator advertisement cues are stripped, negative timings
are clamped, and cues are renumbered. Upstream failures return `502`.

This passthrough exists because subtitle hosts gate downloads on their own
`Origin` allowlist and serve SubRip as `application/octet-stream`, so their URLs
cannot be handed to players directly.

## 🔤 Fallback Subtitles

When a scraping provider returns links without subtitles, the API fills the gap
from an external subtitle provider. Providers are tried in order and the first
one with results wins.

| Provider  | Source                                      | Requirements               |
| --------- | ------------------------------------------- | -------------------------- |
| `natsuki` | `natsuki.maybeoneday.ch` (OpenSubtitles data) | None                       |
| `wyzie`   | `sub.wyzie.io`                              | `WYZIE_SUBS_API_KEY`       |

Results are deduplicated per language and ranked best-first: human translations
before machine ones, plain subtitles before SDH, then by how closely the
subtitle's release name matches the matched file, then by recency. Labels carry
`(SDH)`, `(MT)` and `#n` markers so clients can tell alternatives apart, and
`kind` is `captions` for hearing-impaired tracks and `subtitles` otherwise — the
same response shape as before.

## ⚡ Redis Caching Layer

FlixQuest Scraper includes a fault-tolerant Redis caching layer that caches the full responses of provider scraping calls. This dramatically speeds up repeated streaming requests (from several seconds to < 10ms).

### Features

- **Seamless Fallback**: If Redis is not configured or fails to connect, the scraper operates normally without interruption.
- **Cache Headers**: Every stream response includes an `X-Cache` header:
  - `X-Cache: HIT`: Response served instantly from Redis cache.
  - `X-Cache: MISS`: Response scraped live from upstream provider and cached.
  - `X-Cache: BYPASS`: Cache bypassed via client parameter or header.
- **Cache Bypass**: Bypass the cache and force a fresh scrape by adding `?skipCache=true`, `?nocache=true`, or `?refresh=true` to your query, or by sending the `X-Cache-Bypass: true` HTTP header.
- **Configurable Expiration**: Default TTL is 2 hours (7200 seconds), configurable via `REDIS_CACHE_TTL`.

### Environment Configuration

```env
REDIS_URL=redis://default:password@localhost:6379
# OR discrete connection fields:
# REDIS_HOST=localhost
# REDIS_PORT=6379
# REDIS_PASSWORD=secret
REDIS_CACHE_TTL=7200
REDIS_CACHE_ENABLED=true
```

## Project Structure

```
flixquest-scraper/
├── api/
│   └── index.ts              # Vercel serverless entry point
├── src/
│   ├── index.ts              # Main Express app with API endpoints
│   ├── types/
│   │   └── index.ts          # TypeScript type definitions
│   ├── providers/
│   │   ├── index.ts          # Provider registry and exports
│   │   ├── vixsrc.ts         # Vixsrc provider implementation
│   │   ├── vidsrc.ts         # Vidsrc provider implementation
│   │   ├── vidzee.ts         # Vidzee provider implementation
│   │   ├── uhdmovies.ts      # UHDMovies provider implementation
│   │   ├── showbox.ts        # Showbox provider implementation
│   │   ├── fourkhdhub.ts     # 4K HD Hub provider implementation
│   │   ├── dahmermovies.ts   # DahmerMovies provider implementation
│   │   ├── dahmermovies-tv.ts # DahmerMovies direct-link variant
│   │   ├── streamflix.ts     # StreamFlix provider implementation
│   │   ├── videasy.ts        # VidEasy provider implementation
│   │   └── notorrent.ts      # NoTorrent provider implementation
│   ├── routes/
│   │   ├── dlhd.ts           # DLHD live channel routes
│   │   └── subtitles.ts      # Fallback subtitle passthrough route
│   └── utils/
│       ├── subtitles/        # Fallback subtitle providers and SRT/VTT tooling
│       └── tmdb.ts           # TMDB API helper functions
├── dist/                     # Compiled JavaScript output (gitignored)
├── .env                      # Environment variables (not in git)
├── .env.example              # Example environment variables
├── package.json              # Project dependencies
├── tsconfig.json             # TypeScript configuration
├── nodemon.json              # Nodemon dev server configuration
├── vercel.json               # Vercel deployment config
├── netlify.toml              # Netlify deployment config
├── render.yaml               # Render deployment config
└── README.md                 # This file
```

## Helper Functions

### TMDB Utilities (`src/utils/tmdb.ts`)

#### `generateMovieMedia(tmdbId: string): Promise<MovieMedia>`

Fetches movie metadata from TMDB and generates a `MovieMedia` object.

**Example:**

```typescript
import { generateMovieMedia } from './utils/tmdb.js'

const media = await generateMovieMedia('556574')
// Returns:
// {
//   type: 'movie',
//   title: 'Hamilton',
//   releaseYear: 2020,
//   tmdbId: '556574',
//   imdbId: 'tt8503618'
// }
```

#### `generateShowMedia(tmdbId: string, season: number, episode: number): Promise<ShowMedia>`

Fetches TV show metadata from TMDB and generates a `ShowMedia` object.

**Example:**

```typescript
import { generateShowMedia } from './utils/tmdb.js'

const media = await generateShowMedia('2316', 1, 1)
// Returns:
// {
//   type: 'show',
//   title: 'The Office',
//   releaseYear: 2005,
//   tmdbId: '2316',
//   episode: { number: 1, tmdbId: '170135' },
//   season: { number: 1, tmdbId: '7240', title: 'Season 1', episodeCount: 6 }
// }
```

#### `searchMovies(query: string, year?: number)`

Search for movies on TMDB.

#### `searchTVShows(query: string, year?: number)`

Search for TV shows on TMDB.

### Provider System (`src/providers/`)

The API uses a modular provider system. Each provider implements the `Provider` interface:

```typescript
interface Provider {
  name: string
  id: string
  streamMovie: (tmdbId: string) => Promise<ProviderLink[]>
  streamTV: (
    tmdbId: string,
    season: number,
    episode: number
  ) => Promise<ProviderLink[]>
}
```

**Available Providers:**

- `vixsrc` - Vixsrc streaming provider
- `vidsrc` - Vidsrc streaming provider
- `vidzee` - Vidzee streaming provider
- `uhdmovies` - UHDMovies provider
- `showbox` - Showbox provider
- `4khdhub` - 4K HD Hub provider
- `4khdhubnew` - 4KHDHub-NEW broad-search provider
- `dahmermovies` - DahmerMovies direct-file provider
- `dahmermovies-tv` - DahmerMovies direct-link/Android TV variant
- `streamflix` - StreamFlix movie and episode provider
- `videasy` - VidEasy multi-server provider
- `videasy2` - VidEasy WASM-backed multi-server provider
- `notorrent` - NoTorrent Stremio-addon provider
- `bollyflix` - BollyFlix live-catalog direct-file provider
- `playimdb` - PlayIMDb direct-stream provider
- `vidlink` - Vidlink multi-quality provider
- `netmirror` - NetMirror multi-quality movie and episode provider
- `tamilian` - Tamilian 1080p movie provider
- `vidfast` - VidFast multi-server movie and episode provider
- `castle` - Castle multi-quality movie and episode provider
- `peachify` - Peachify multi-mirror movie and episode provider
- `movieblast` - MovieBlast signed-link movie and episode provider
- `purstream` - PurStream English/French movie and episode provider
- `movix` - Movix Hollywood movie and episode aggregator
- `xpass` - XPass multi-server movie and episode provider
- `kisskh` - Asian drama/movie provider with original audio and English subtitles
- `dramafull` - Additional Asian and K-drama fallback provider
- `toonhub` - English/Hindi/Japanese anime and cartoon provider
- `cuevana` - Castilian and Latin-American Spanish movie and episode provider
- `jetfilmizle` - Turkish movie and episode provider with multi-audio HLS
- `vidrock` - VidRock AES-GCM-decrypted multi-server movie and episode provider
- `vidnest` - VidNest multi-server movie and episode provider (custom-base64 payloads)
- `vidup` - VidUp multi-server movie and episode provider
- `goated` - GOATED proof-of-work resolver with adaptive HLS quality detection
- `bingr` - Bingr nine-server provider with explicit quality/language metadata
- `rive` - Rive multi-resolver provider with direct HLS/MP4 streams and subtitles
- `vidrift` - VidRift Earth resolver with distinct CDN roots and adaptive HLS qualities
- `vuflix` - Vuflix dynamic multi-source provider with Sigma, 4K, Upsilon, and every currently advertised backend
- `cinevaro` - Cinevaro first-party resolver using direct JSON and adaptive HLS requests
- `fsharetv` - FshareTV movie resolver with explicit 360p/480p/720p/1080p MP4 tiers when available
- `vyla` - Vyla movie and episode resolver using direct MP4/HLS sources up to 1080p

For catalog, audio-language, and quality details, see
[`src/providers/PROVIDER_GUIDE.md`](src/providers/PROVIDER_GUIDE.md).

## Error Handling

The API returns consistent error responses:

```json
{
  "success": false,
  "error": "Error message",
  "details": "Additional error details"
}
```

**Common HTTP Status Codes:**

- `200`: Success
- `400`: Bad request (missing or invalid parameters)
- `404`: Media not found
- `500`: Internal server error

## Finding TMDB IDs

To find TMDB IDs for movies and TV shows:

1. Go to [The Movie Database](https://www.themoviedb.org/)
2. Search for your movie or TV show
3. The ID is in the URL: `https://www.themoviedb.org/movie/{TMDB_ID}`
4. Or use the search endpoints in this API

## Environment Variables

Create a `.env` file in the root directory (see `.env.example` for reference):

| Variable              | Description                                                            | Required | Default                   |
| --------------------- | ---------------------------------------------------------------------- | -------- | ------------------------- |
| `TMDB_API_KEY`        | Your TMDB API key from [TMDB](https://www.themoviedb.org/settings/api) | Yes      | -                         |
| `INTRO_VIDEO_URL`     | Absolute HTTP(S) URL for the branded pre-stream intro                  | No       | -                         |
| `INTRO_VIDEO_ENABLED` | Explicitly enable or disable the branded intro                         | No       | Enabled when a URL is set |
| `SUBTITLE_PROVIDERS`  | Priority order of the fallback subtitle providers                      | No       | `natsuki,wyzie`           |
| `SUBTITLE_OUTPUT_FORMAT` | Format served for fallback subtitles (`vtt` or `srt`)               | No       | `vtt`                     |
| `SUBTITLE_MAX_PER_LANGUAGE` | Alternative subtitles kept per language                          | No       | `5`                       |
| `WYZIE_SUBS_API_KEY`  | API key for the `wyzie` subtitle provider                              | No       | -                         |
| `PUBLIC_BASE_URL`     | Public origin used to build absolute subtitle URLs                     | No       | Derived from the request  |
| `PORT`                | Server port                                                            | No       | `3000`                    |
| `NODE_ENV`            | Environment mode (`production` or `development`)                       | No       | -                         |

## Development

### Running in Development Mode

```bash
pnpm dev
```

This uses nodemon to automatically restart the server when files change.

### Building for Production

```bash
pnpm build
```

Compiles TypeScript to JavaScript in the `dist/` directory.

### Starting Production Server

```bash
pnpm start
```

Runs the compiled JavaScript from the `dist/` directory.

## Technologies Used

- **Express.js**: Web framework
- **TypeScript**: Type-safe JavaScript
- **Axios**: HTTP client for TMDB API
- **Cheerio**: HTML parsing for web scraping
- **Crypto-JS**: Encryption and decryption utilities
- **Nodemon**: Development auto-reload
- **dotenv**: Environment variable management

## License

ISC

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Disclaimer

This tool is for educational purposes only. Make sure you have the rights to access and stream any content you use with this API. Respect copyright laws and terms of service of streaming platforms.
