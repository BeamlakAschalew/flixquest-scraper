# FlixQuest Scraper API

A powerful Express.js API for scraping streaming links for movies and TV shows using TMDB metadata and the @p-stream/providers library.

## Features

- 🎬 **Movie Streaming**: Get streaming links for movies using TMDB ID
- 📺 **TV Show Streaming**: Get streaming links for TV show episodes using TMDB ID, season, and episode number
- 🔍 **Automatic Metadata Fetching**: Automatically fetches movie/show metadata from TMDB API
- 🌐 **Multiple Sources**: Supports multiple streaming sources and embeds
- 📝 **TypeScript**: Full TypeScript support with type definitions
- ⚡ **Fast**: Built with Express.js for high performance

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

### 1. Stream Movie

Get streaming link for a movie using TMDB ID.

**Endpoint:** `GET /stream-movie`

**Query Parameters:**

- `tmdbId` (string, required): The TMDB ID of the movie

**Example:**

```bash
curl "http://localhost:3000/stream-movie?tmdbId=556574"
```

**Response:**

```json
{
  "success": true,
  "media": {
    "type": "movie",
    "title": "Hamilton",
    "releaseYear": 2020,
    "tmdbId": "556574"
  },
  "stream": {
    "sourceId": "flixhq",
    "embedId": "upcloud",
    "type": "hls",
    "id": "stream-id",
    "playlist": "https://example.com/playlist.m3u8",
    "flags": [],
    "captions": []
  }
}
```

### 2. Stream TV Show

Get streaming link for a TV show episode using TMDB ID, season, and episode number.

**Endpoint:** `GET /stream-tv`

**Query Parameters:**

- `tmdbId` (string, required): The TMDB ID of the TV show
- `season` (number, required): Season number
- `episode` (number, required): Episode number

**Example:**

```bash
curl "http://localhost:3000/stream-tv?tmdbId=2316&season=1&episode=1"
```

**Response:**

```json
{
  "success": true,
  "media": {
    "type": "show",
    "title": "The Office - S1E1",
    "releaseYear": 2005,
    "tmdbId": "2316"
  },
  "stream": {
    "sourceId": "flixhq",
    "embedId": "upcloud",
    "type": "hls",
    "id": "stream-id",
    "playlist": "https://example.com/playlist.m3u8",
    "flags": [],
    "captions": []
  }
}
```

### 3. List Sources

Get all available streaming sources.

**Endpoint:** `GET /sources`

**Example:**

```bash
curl "http://localhost:3000/sources"
```

**Response:**

```json
{
  "success": true,
  "sources": [
    {
      "id": "flixhq",
      "name": "FlixHQ",
      "rank": 100,
      "mediaTypes": ["movie", "show"]
    }
  ]
}
```

### 4. List Embeds

Get all available embed scrapers.

**Endpoint:** `GET /embeds`

**Example:**

```bash
curl "http://localhost:3000/embeds"
```

**Response:**

```json
{
  "success": true,
  "embeds": [
    {
      "id": "upcloud",
      "name": "UpCloud",
      "rank": 200
    }
  ]
}
```

## Project Structure

```
flixquest-scraper/
├── src/
│   ├── index.ts              # Main Express app with API endpoints
│   ├── types/
│   │   └── index.ts          # TypeScript type definitions
│   └── utils/
│       ├── tmdb.ts           # TMDB API helper functions
│       └── providers.ts      # Provider configuration utilities
├── .env                      # Environment variables (not in git)
├── .env.example              # Example environment variables
├── package.json              # Project dependencies
├── tsconfig.json             # TypeScript configuration
└── README.md                 # This file
```

## Helper Functions

### TMDB Utilities (`src/utils/tmdb.ts`)

#### `generateMovieMedia(tmdbId: string): Promise<MovieMedia>`

Fetches movie metadata from TMDB and generates a `MovieMedia` object ready for streaming.

**Example:**

```typescript
import { generateMovieMedia } from "./utils/tmdb.js";

const media = await generateMovieMedia("556574");
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

Fetches TV show metadata from TMDB and generates a `ShowMedia` object ready for streaming.

**Example:**

```typescript
import { generateShowMedia } from "./utils/tmdb.js";

const media = await generateShowMedia("2316", 1, 1);
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

### Provider Utilities (`src/utils/providers.ts`)

#### `buildProviders(): ProviderControls`

Creates and configures a provider instance with standard settings.

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

| Variable       | Description                 | Required |
| -------------- | --------------------------- | -------- |
| `TMDB_API_KEY` | Your TMDB API key           | Yes      |
| `PORT`         | Server port (default: 3000) | No       |

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
- **@p-stream/providers**: Streaming source scrapers
- **Axios**: HTTP client for TMDB API
- **Nodemon**: Development auto-reload

## License

ISC

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Disclaimer

This tool is for educational purposes only. Make sure you have the rights to access and stream any content you use with this API. Respect copyright laws and terms of service of streaming platforms.
