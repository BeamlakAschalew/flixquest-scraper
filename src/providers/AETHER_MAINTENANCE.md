# Aether provider maintenance

Last verified: **2026-07-24**

This document describes the server-side `aether` provider in this repository.
It intentionally calls Aether's individual source workers concurrently and
keeps successful streams when other workers fail.

## User-facing behavior

- Provider ID: `aether`
- Movies: `/v2/stream-movie?tmdbId=884605&provider=aether`
- TV:
  `/v2/stream-tv?tmdbId=125988&season=1&episode=1&provider=aether`
- Primary output: adaptive HLS (`Auto`)
- Common audio on the general sources: 🌐 original audio, usually 🇬🇧 English
  for English-language titles
- Regional workers: 🇲🇽 Latin-American Spanish, 🇪🇸 Castilian Spanish,
  🇩🇪 German and 🇫🇷 French
- Meridian currently returns many separate subtitle tracks, including English,
  Spanish, French, German, Turkish, Arabic and several Asian and European
  languages. Subtitle availability varies by title.

Aether is an aggregator. A failed worker is normal and does not make the whole
provider fail. The implementation uses `Promise.allSettled()` and returns every
unique usable URL from the workers that responded.

## Web application architecture

The tested site is `https://aether.bar`. It is a p-stream-style single-page
application. The tested build loaded:

- `/assets/index-BB5hgv0Z.js`
- `/assets/PlayerView-Dr2ql_Ow.js`
- `/assets/vendor-NZwZbizz.js`
- `/config.js`

Asset hashes will change on deployment. Locate the current player asset in the
site HTML and search it for `runSourceScraper`, `listSources`, or
`manualSourceSelect` when repairing a future build.

The web client exposes source metadata through its provider registry. At the
time of verification its movie/TV source order was:

1. `lul` — Lul 👾
2. `link` — Link 🔗
3. `nebula` — Nebula 🌌
4. `meridian` — Meridian 🪐
5. `tiki` — Tiki 🗿
6. `vidy` — Vidy 📺
7. `aether-subtitulado` — Subtitulado 🇪🇸
8. `aether-latino` — Latino
9. `aether-castellano` — Castellano 🇪🇸
10. `cowflix` — Cowflix 🇩🇪
11. `gallic` — Gallic 🇫🇷
12. `vidlink` — KingLink
13. `diziyou` — Turkish TV only
14. `animetsu` — anime TV only

This repository directly implements the first eleven HTTP workers. KingLink
uses an additional encrypted VidLink request, while Diziyou and Animetsu need
title/episode metadata and their own embed resolvers; they are deliberately
excluded instead of pretending their requests are equivalent.

## Exact worker calls

All calls are `GET` requests. The implementation sends:

```text
Accept: application/json, text/plain, */*
Origin: https://aether.bar
Referer: https://aether.bar/
User-Agent: a Chromium browser user agent
```

Replace `{tmdb}`, `{season}` and `{episode}` with numeric values.

| Source      | Movie call                                     | TV call                                                           |
| ----------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| Lul         | `https://lul.aether.cx/movie/{tmdb}`           | `https://lul.aether.cx/tv/{tmdb}/{season}/{episode}`              |
| Link        | `https://link.aether.cx/movie/{tmdb}`          | `https://link.aether.cx/tv/{tmdb}/{season}/{episode}`             |
| Nebula      | `https://nebula.aether.cx/movie/{tmdb}?ser=cf` | `https://nebula.aether.cx/tv/{tmdb}/{season}/{episode}?ser=cf`    |
| Meridian    | `https://meridian.aether.bar/movie/{tmdb}`     | `https://meridian.aether.bar/show/{tmdb}/{season}/{episode}`      |
| Tiki        | `https://tiki.aether.cx/movie/{tmdb}`          | `https://tiki.aether.cx/tv/{tmdb}/{season}/{episode}`             |
| Vidy        | `https://vidy.aether.cx/movie/{tmdb}`          | `https://vidy.aether.cx/tv/{tmdb}/{season}/{episode}`             |
| Subtitulado | `https://sol.aether.bar/movie/{tmdb}?lang=sub` | `https://sol.aether.bar/tv/{tmdb}/{season}/{episode}?lang=sub`    |
| Latino      | `https://sol.aether.bar/movie/{tmdb}?lang=lat` | `https://sol.aether.bar/tv/{tmdb}/{season}/{episode}?lang=lat`    |
| Castellano  | `https://sol.aether.bar/movie/{tmdb}?lang=esp` | `https://sol.aether.bar/tv/{tmdb}/{season}/{episode}?lang=esp`    |
| Cowflix     | `https://cow.aether.bar/movie/{tmdb}`          | `https://cow.aether.bar/tv/{tmdb}/{season}/{episode}`             |
| Gallic      | `https://baguette.aether.cx/api/movie/{tmdb}`  | `https://baguette.aether.cx/api/tv/{tmdb}?s={season}&e={episode}` |

The TV path difference for Meridian (`show`, not `tv`) is intentional.

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
  "title": "Silo - S1E1",
  "url": "https://yield.aether.bar/m3u8-proxy?url=...&headers=...",
  "subtitles": [
    {
      "language": "English",
      "url": "https://.../subtitle/...",
      "type": "vtt"
    }
  ]
}
```

Tiki:

```json
{
  "stream": "https://tiki.aether.cx/.../master.m3u8"
}
```

Other workers have used `url`, `file`, `stream`, `streams`, `sources`, or
`urls`. The parser accepts those known shapes but does not recursively harvest
arbitrary URLs, which prevents subtitle or tracking URLs from being mislabeled
as video.

## Live verification result

For movie TMDB `884605` (`No Hard Feelings`):

- ✅ Nebula returned HLS.
- ✅ Meridian returned HLS plus multilingual subtitles.
- ❌ Lul, Tiki and Vidy hit an upstream `429` during this check.
- ❌ Link's worker was unavailable.
- ❌ The regional workers had no matching stream for this title during the
  check.

For TV TMDB `125988`, season 1, episode 1 (`Silo`):

- ✅ Nebula returned HLS.
- ✅ Meridian returned HLS plus multilingual subtitles.
- ✅ Tiki returned HLS.
- ❌ Lul hit an upstream `429`.
- ❌ Link and the remaining tested workers returned unavailable/not-found.

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
curl 'http://localhost:3000/v2/stream-tv?tmdbId=125988&season=1&episode=1&provider=aether'
```

The provider needs no API key, cookie, Cloudflare clearance, or browser
automation as of the verification date.
