# FlixQuest Scraper API

A powerful Express.js API for scraping streaming links for movies and TV shows using TMDB metadata. Supports multiple streaming providers with a modular, extensible architecture.

## Features

- 🎬 **Movie Streaming**: Get streaming links for movies using TMDB ID
- 📺 **TV Show Streaming**: Get streaming links for TV show episodes using TMDB ID, season, and episode number
- 🔍 **Automatic Metadata Fetching**: Automatically fetches movie/show metadata from TMDB API
- 🌐 **Multiple Providers**: Supports 6 streaming providers (Vixsrc, Vidsrc, Vidzee, UHDMovies, Showbox, 4K HD Hub)
- 🔌 **Modular Architecture**: Easy to add new providers
- 📝 **TypeScript**: Full TypeScript support with type definitions
- ⚡ **Fast**: Built with Express.js for high performance
- 🚀 **Deployment Ready**: Supports Vercel, Netlify, and Render deployments

## Prerequisites

- Node.js (v18 or higher recommended)
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
  "version": "1.0.0",
  "status": "running",
  "endpoints": {
    "streamMovie": "GET /stream-movie?tmdbId={id}",
    "streamTV": "GET /stream-tv?tmdbId={id}&season={num}&episode={num}",
    "providerStreamMovie": "GET /:provider/stream-movie?tmdbId={id}",
    "providerStreamTV": "GET /:provider/stream-tv?tmdbId={id}&season={num}&episode={num}",
    "providers": "GET /providers",
    "sources": "GET /sources",
    "embeds": "GET /embeds"
  },
  "availableProviders": [
    "vixsrc",
    "vidsrc",
    "vidzee",
    "uhdmovies",
    "showbox",
    "4khdhub"
  ]
}
```

### 2. List Providers

Get all available streaming providers.

**Endpoint:** `GET /providers`

**Example:**

```bash
curl "http://localhost:3000/providers"
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
    { "id": "4khdhub", "name": "4K HD Hub" }
  ]
}
```

### 3. Stream Movie (Provider-Specific)

Get streaming links for a movie using TMDB ID from a specific provider.

**Endpoint:** `GET /:provider/stream-movie`

**Path Parameters:**

- `provider` (string, required): Provider ID (e.g., `vixsrc`, `vidsrc`, `vidzee`, `uhdmovies`, `showbox`, `4khdhub`)

**Query Parameters:**

- `tmdbId` (string, required): The TMDB ID of the movie

**Example:**

```bash
curl "http://localhost:3000/vixsrc/stream-movie?tmdbId=556574"
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

### 4. Stream TV Show (Provider-Specific)

Get streaming links for a TV show episode using TMDB ID, season, and episode number from a specific provider.

**Endpoint:** `GET /:provider/stream-tv`

**Path Parameters:**

- `provider` (string, required): Provider ID (e.g., `vixsrc`, `vidsrc`, `vidzee`, `uhdmovies`, `showbox`, `4khdhub`)

**Query Parameters:**

- `tmdbId` (string, required): The TMDB ID of the TV show
- `season` (number, required): Season number
- `episode` (number, required): Episode number

**Example:**

```bash
curl "http://localhost:3000/vixsrc/stream-tv?tmdbId=2316&season=1&episode=1"
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
│   │   └── fourkhdhub.ts     # 4K HD Hub provider implementation
│   └── utils/
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

| Variable       | Description                                                            | Required | Default |
| -------------- | ---------------------------------------------------------------------- | -------- | ------- |
| `TMDB_API_KEY` | Your TMDB API key from [TMDB](https://www.themoviedb.org/settings/api) | Yes      | -       |
| `PORT`         | Server port                                                            | No       | `3000`  |
| `NODE_ENV`     | Environment mode (`production` or `development`)                       | No       | -       |

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
