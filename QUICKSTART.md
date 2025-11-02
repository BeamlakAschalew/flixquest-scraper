# 🚀 Quick Start Guide

Get your FlixQuest Scraper API up and running in 5 minutes!

## Step 1: Get TMDB API Key (2 minutes)

1. Go to https://www.themoviedb.org/signup
2. Create a free account
3. Go to https://www.themoviedb.org/settings/api
4. Request an API key (select "Developer" option)
5. Copy your API key

## Step 2: Configure Environment (30 seconds)

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env and add your TMDB API key
# TMDB_API_KEY=your_actual_key_here
```

## Step 3: Install Dependencies (1 minute)

```bash
pnpm install
```

## Step 4: Start the Server (10 seconds)

```bash
pnpm dev
```

You should see:

```
🚀 FlixQuest Scraper API running at http://localhost:3000
📖 API Documentation:
   GET /stream-movie?tmdbId={id}
   GET /stream-tv?tmdbId={id}&season={num}&episode={num}
   GET /sources
   GET /embeds

⚠️  Make sure to set TMDB_API_KEY environment variable
```

## Step 5: Test It! (1 minute)

### Test in Browser

Open these URLs in your browser:

**Health Check:**

```
http://localhost:3000/
```

**Stream Hamilton:**

```
http://localhost:3000/stream-movie?tmdbId=556574
```

**Stream The Office S1E1:**

```
http://localhost:3000/stream-tv?tmdbId=2316&season=1&episode=1
```

### Test with cURL

```bash
# Stream a movie
curl "http://localhost:3000/stream-movie?tmdbId=556574"

# Stream a TV show
curl "http://localhost:3000/stream-tv?tmdbId=2316&season=1&episode=1"

# List sources
curl "http://localhost:3000/sources"
```

### Test with the Included Script

```bash
tsx test.ts
```

## 🎉 You're Done!

Your API is now running and ready to use!

## 📝 What's Next?

- Read the full [README.md](README.md) for detailed documentation
- Check out [EXAMPLES.md](EXAMPLES.md) for more usage examples
- Import `FlixQuest-Scraper.postman_collection.json` into Postman for easy testing
- Build something awesome!

## 🆘 Troubleshooting

### "TMDB_API_KEY is not configured"

- Make sure you created the `.env` file
- Check that your API key is correct
- Restart the server after adding the key

### "Failed to fetch movie from TMDB"

- Verify your API key is valid
- Check your internet connection
- Make sure the TMDB ID is correct

### Port 3000 already in use

Edit `.env` and change the port:

```env
PORT=3001
```

## 📚 Resources

- **TMDB API Docs**: https://developers.themoviedb.org/3
- **Find TMDB IDs**: https://www.themoviedb.org/
- **Full Documentation**: [README.md](README.md)

---

**Happy Streaming! 🎬📺**
