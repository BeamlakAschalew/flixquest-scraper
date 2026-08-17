# Aether provider maintenance

Last verified: **2026-08-13**

This document describes the server-side `aether` provider in this repository.
It calls Aether's individual source workers concurrently and keeps successful
streams when other workers fail.

## User-facing behavior

- Provider ID: `aether`
- Movies: `/v2/stream-movie?tmdbId=884605&provider=aether`
- TV: `/v2/stream-tv?tmdbId=125988&season=1&episode=1&provider=aether`
- Primary output: adaptive HLS (`Auto`)
- Common audio on the general sources: 🌐 original audio, usually 🇬🇧 English
  for English-language titles
- Regional workers: 🇲🇽 Latin-American Spanish, 🇪🇸 Castilian Spanish,
  🇩🇪 German and 🇫🇷 French
- Meridian currently returns many separate subtitle tracks, including English,
  Spanish, French, German, Turkish, Arabic and several Asian and European
  languages. Subtitle availability varies by title.

Aether streams remain unproxied. Links on `tnmr.org` and its subdomains are
discarded because their signed URLs return nginx `403 Forbidden` from client
IPs even when the Aether `Origin`, `Referer`, and user-agent headers are
present.

Aether is an aggregator. A failed worker is normal and does not make the whole
provider fail. The implementation uses `Promise.allSettled()` and returns every
unique usable URL from the workers that responded.

## Request headers

The workers reject plain server requests with Cloudflare blocks. Every lookup
must carry a Chromium user agent plus the Aether origin pair:

```text
Accept: application/json, text/plain, */*
Accept-Language: en-US,en;q=0.9
Origin: https://aether.bar
Referer: https://aether.bar/
User-Agent: <Chromium UA>
```

## Worker calls

All calls are `GET` requests. Replace `{tmdb}`, `{season}` and `{episode}`
with numeric values.

| Source      | Movie call                                                          | TV call                                                                   |
| ----------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Lul         | `https://lul.aether.cx/movie/{tmdb}`                                | `https://lul.aether.cx/tv/{tmdb}/{season}/{episode}`                       |
| Link        | `https://link.aether.cx/movie/{tmdb}`                               | `https://link.aether.cx/tv/{tmdb}/{season}/{episode}`                      |
| Nebula      | `https://nebula.aether.cx/movie/{tmdb}?ser=cf`                      | `https://nebula.aether.cx/tv/{tmdb}/{season}/{episode}?ser=cf`             |
| Meridian    | `https://meridian.aether.bar/movie/{tmdb}`                          | `https://meridian.aether.bar/show/{tmdb}/{season}/{episode}`               |
| Tiki        | `https://tiki.aether.cx/movie/{tmdb}`                               | `https://tiki.aether.cx/tv/{tmdb}/{season}/{episode}`                      |
| Vidy        | `https://vidy.aether.cx/movie/{tmdb}`                               | `https://vidy.aether.cx/tv/{tmdb}/{season}/{episode}`                      |
| Vine        | `https://vine.aether.cx/movie/{tmdb}`                               | `https://vine.aether.cx/tv/{tmdb}/{season}/{episode}`                      |
| Fast        | `https://fast.aether.cx/scrape?type=movie&tmdbId={tmdb}`            | `https://fast.aether.cx/scrape?type=show&tmdbId={tmdb}&season={s}&episode={e}` |
| Subtitulado | `https://sol.aether.bar/movie/{tmdb}?lang=sub`                      | `https://sol.aether.bar/tv/{tmdb}/{season}/{episode}?lang=sub`             |
| Latino      | `https://sol.aether.bar/movie/{tmdb}?lang=lat`                      | `https://sol.aether.bar/tv/{tmdb}/{season}/{episode}?lang=lat`             |
| Castellano  | `https://sol.aether.bar/movie/{tmdb}?lang=esp`                      | `https://sol.aether.bar/tv/{tmdb}/{season}/{episode}?lang=esp`             |
| Cowflix     | `https://cow.aether.bar/movie/{tmdb}`                               | `https://cow.aether.bar/tv/{tmdb}/{season}/{episode}`                      |
| Gallic      | `https://baguette.aether.cx/api/movie/{tmdb}`                       | `https://baguette.aether.cx/api/tv/{tmdb}?s={season}&e={episode}`          |

The TV path difference for Meridian (`show`, not `tv`) is intentional.
`Fast` is the worker behind the client's `vidapi-click` source and uses query
parameters instead of path segments.

## Observed response shapes

Nebula:

```json
{
  "success": true,
  "streams": [
    {
      "name": "Cloudflare",
      "url": "https://nebula.aether.cx/hls/.../master.m3u8",
      "type": "hls"
    }
  ]
}
```

Meridian:

```json
{
  "title": "Ted Lasso - S1E1",
  "url": "https://cdn.neuronix.sbs/segment/...?token1=...&token3=...",
  "subtitles": [
    { "language": "English", "url": "https://cdn.syntraa.fun/subtitle/...", "type": "vtt" }
  ]
}
```

Link:

```json
{ "id": 884605, "title": "No Hard Feelings 2023", "stream": "https://.../pl/..." }
```

Tiki and Lul:

```json
{ "stream": "https://tiki.aether.cx/.../master.m3u8" }
```

Vine:

```json
{
  "id": 884605,
  "type": "movie",
  "title": "No Hard Feelings",
  "streams": [
    { "server": "atlas", "type": "mp4", "quality": "720p", "url": "https://.../995111_720p.mp4/" }
  ]
}
```

The parser accepts `url`, `file`, `stream`, `streams`, `sources`, or `urls`
payload fields and does not recursively harvest arbitrary URLs, which
prevents subtitle or tracking URLs from being mislabeled as video.

## Live verification result (2026-08-13)

For movie TMDB `884605` (`No Hard Feelings`):

- ✅ Link returned a stream.
- ✅ Nebula returned HLS.
- ✅ Meridian returned HLS plus multilingual subtitles.
- ✅ Tiki returned HLS.
- ✅ Vine returned MP4 qualities.
- ❌ Lul returned `No LUL backup found` / Cloudflare `1015` during this check
  (rate limiting is intermittent).
- ❌ Vidy returned `502` (worker down).
- ❌ Fast returned Cloudflare `1033` from the scraper IP (client lists this
  source as disabled as well).
- ❌ Sol returned `530`, Cowflix returned `502`, Gallic returned `404`.

For TV TMDB `97546`, season 1, episode 1 (`Ted Lasso`):

- ✅ Link, Nebula, Meridian (with subtitles), Tiki and Lul returned streams.
- ❌ Vine had no streams for this episode; Vidy, Fast and the regional
  workers were unavailable.

These results are a snapshot, not a permanent allowlist. Keep every worker in
the concurrent probe because availability changes by title and over time.

## Repair checklist

1. Open the current Aether page and locate its hashed `index` and `PlayerView`
   assets.
2. In the browser console, import the current index asset and inspect the
   export whose value has `listSources()` and `runSourceScraper()`.
3. Compare source IDs and ranks with the registry above.
4. Record network requests while manually selecting each source.
5. Update only the changed endpoint builder in `aether.ts`.
6. Capture a successful response and add its explicit field names to
   `AetherPayload`/`streamEntries()` if the schema changed.
7. Run both test endpoints below.
8. Confirm at least one returned URL serves an HLS manifest rather than HTML.

Useful direct checks:

```bash
curl 'http://localhost:3000/v2/stream-movie?tmdbId=884605&provider=aether'
curl 'http://localhost:3000/v2/stream-tv?tmdbId=97546&season=1&episode=1&provider=aether'
```

The provider needs no API key, cookie, Cloudflare clearance, or browser
automation as of the verification date.
