# FlixQuest Scraper - Quick Start Examples

## Setup

1. Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

2. Add your TMDB API key to `.env`:

```env
TMDB_API_KEY=your_actual_tmdb_api_key_here
PORT=3000
```

3. Install dependencies:

```bash
pnpm install
```

4. Start the server:

```bash
pnpm dev
```

## Example Usage

### 1. Stream a Movie (Hamilton)

**TMDB ID**: 556574

```bash
curl "http://localhost:3000/v2/stream-movie?tmdbId=556574&provider=vixsrc"
```

Or visit in browser:

```
http://localhost:3000/v2/stream-movie?tmdbId=556574&provider=vixsrc
```

**Expected Response:**

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
      "server": "vixsrc",
      "url": "https://...",
      "isM3U8": true,
      "quality": "1080p",
      "subtitles": []
    }
  ]
}
```

### 2. Stream a TV Show Episode (The Office S1E1)

**TMDB ID**: 2316

```bash
curl "http://localhost:3000/v2/stream-tv?tmdbId=2316&season=1&episode=1&provider=vixsrc"
```

Or visit in browser:

```
http://localhost:3000/v2/stream-tv?tmdbId=2316&season=1&episode=1&provider=vixsrc
```

**Expected Response:**

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
      "server": "vixsrc",
      "url": "https://...",
      "isM3U8": true,
      "quality": "1080p",
      "subtitles": []
    }
  ]
}
```

### 3. More Examples

#### Breaking Bad S1E1

```bash
curl "http://localhost:3000/v2/stream-tv?tmdbId=1396&season=1&episode=1&provider=vixsrc"
```

#### The Shawshank Redemption

```bash
curl "http://localhost:3000/v2/stream-movie?tmdbId=278&provider=vixsrc"
```

#### Inception

```bash
curl "http://localhost:3000/v2/stream-movie?tmdbId=27205&provider=vixsrc"
```

#### Fight Club via DahmerMovies

```bash
curl "http://localhost:3000/v2/stream-movie?tmdbId=550&provider=dahmermovies"
```

#### Fight Club via NoTorrent

```bash
curl "http://localhost:3000/v2/stream-movie?tmdbId=550&provider=notorrent"
```

#### Stranger Things S1E1

```bash
curl "http://localhost:3000/v2/stream-tv?tmdbId=66732&season=1&episode=1&provider=vixsrc"
```

### 4. List Available Providers

```bash
curl "http://localhost:3000/v2/providers"
```

## Using in Your Application

### JavaScript/TypeScript

```typescript
// Fetch a movie stream
async function getMovieStream(tmdbId: string) {
  const response = await fetch(
    `http://localhost:3000/v2/stream-movie?tmdbId=${tmdbId}&provider=vixsrc`
  )
  const data = await response.json()

  if (data.success) {
    console.log('Stream URL:', data.links[0].url)
    console.log('Captions:', data.links[0].subtitles)
    return data.links
  } else {
    console.error('Error:', data.error)
    throw new Error(data.error)
  }
}

// Fetch a TV show stream
async function getTVStream(tmdbId: string, season: number, episode: number) {
  const response = await fetch(
    `http://localhost:3000/v2/stream-tv?tmdbId=${tmdbId}&season=${season}&episode=${episode}&provider=vixsrc`
  )
  const data = await response.json()

  if (data.success) {
    console.log('Stream URL:', data.links[0].url)
    return data.links
  } else {
    console.error('Error:', data.error)
    throw new Error(data.error)
  }
}

// Example usage
getMovieStream('556574').then(stream => {
  console.log('Got stream for Hamilton:', stream)
})

getTVStream('2316', 1, 1).then(stream => {
  console.log('Got stream for The Office S1E1:', stream)
})
```

### Python

```python
import requests

# Fetch a movie stream
def get_movie_stream(tmdb_id):
    response = requests.get(
        f'http://localhost:3000/v2/stream-movie?tmdbId={tmdb_id}&provider=vixsrc'
    )
    data = response.json()

    if data['success']:
        print(f"Stream URL: {data['links'][0]['url']}")
        return data['links']
    else:
        raise Exception(data['error'])

# Fetch a TV show stream
def get_tv_stream(tmdb_id, season, episode):
    response = requests.get(
        f'http://localhost:3000/v2/stream-tv',
        params={'tmdbId': tmdb_id, 'season': season, 'episode': episode, 'provider': 'vixsrc'}
    )
    data = response.json()

    if data['success']:
        print(f"Stream URL: {data['links'][0]['url']}")
        return data['links']
    else:
        raise Exception(data['error'])

# Example usage
stream = get_movie_stream('556574')
print('Got stream for Hamilton:', stream)

stream = get_tv_stream('2316', 1, 1)
print('Got stream for The Office S1E1:', stream)
```

## Finding TMDB IDs

### Method 1: TMDB Website

1. Go to https://www.themoviedb.org/
2. Search for your movie/show
3. The ID is in the URL: `https://www.themoviedb.org/movie/{ID}` or `https://www.themoviedb.org/tv/{ID}`

### Method 2: Popular Content

Some popular TMDB IDs for testing:

**Movies:**

- The Shawshank Redemption: `278`
- The Godfather: `238`
- Inception: `27205`
- Interstellar: `157336`
- Hamilton: `556574`
- The Dark Knight: `155`

**TV Shows:**

- Breaking Bad: `1396`
- The Office (US): `2316`
- Game of Thrones: `1399`
- Stranger Things: `66732`
- The Mandalorian: `82856`

## Common Issues

### Error: "TMDB_API_KEY is not configured"

- Make sure you've created a `.env` file
- Add your TMDB API key: `TMDB_API_KEY=your_key_here`
- Restart the server

### Error: "Movie not found on any source"

- The content might not be available on the scrapers
- Try a different movie/show
- Some content may be region-locked

### Error: "Failed to fetch movie from TMDB"

- Check your TMDB API key is valid
- Verify the TMDB ID is correct
- Check your internet connection

## Stream Types

The API returns two types of streams:

### HLS Stream

```json
{
  "type": "hls",
  "playlist": "https://example.com/playlist.m3u8",
  "headers": {...}
}
```

Use with HLS players like hls.js, Video.js, or native HLS support.

### File Stream

```json
{
  "type": "file",
  "qualities": {
    "1080": { "type": "mp4", "url": "..." },
    "720": { "type": "mp4", "url": "..." }
  }
}
```

Direct MP4 links for different quality levels.

## Rate Limiting

Be mindful when making requests:

- TMDB API has rate limits (check their docs)
- Streaming sources may have rate limits
- Consider implementing caching for frequently requested content

## Next Steps

- Implement caching with Redis
- Add request rate limiting
- Add authentication
- Deploy to production (Railway, Render, etc.)
- Create a frontend UI
- Add webhook support for notifications
