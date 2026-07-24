# WatchFlux provider maintenance

Last verified: **2026-07-24**

Provider ID: `watchflux`  
Implementation: [`watchflux.ts`](./watchflux.ts)  
Site: <https://watchflux.tv/>

## Current behavior

WatchFlux exposes one preferred direct source in its server-rendered watch
page:

```json
{
  "service": "neon",
  "url": "https://<host>/<opaque-id>/playlist.m3u8",
  "type": "direct"
}
```

The same URL is placed in:

- `fullMedia.videoUrl`;
- `fullMedia.sources`;
- the separately encoded `sourcesStr` array;
- the player `<source>` element.

The WatchFlux application calls this source **Neon**. Its resolver and
encrypted response format are shared with the existing Cineby Neon
integration. This repository therefore reuses `getCinebyNeonStreams()` rather
than duplicating that protocol or attempting to fetch WatchFlux's
Cloudflare-protected HTML.

## Test pages

Movie:

```text
https://watchflux.tv/watch/movie/884605
```

Episode:

```text
https://watchflux.tv/watch/tv/2316/season/9/episode/1
```

Repository endpoints:

```text
GET /v2/stream-movie?tmdbId=884605&provider=watchflux
GET /v2/stream-tv?tmdbId=2316&season=9&episode=1&provider=watchflux
```

## Confirmed player data

The movie page embedded:

```text
service: neon
type: direct
host: gypsy.uwucdn.sbs
path: /<opaque-id>/playlist.m3u8
```

The supplied episode used the same service and host with a different opaque
path.

Both master playlists returned:

```m3u8
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720
hls/playlist.m3u8
```

The actual verified quality is therefore **720p**. WatchFlux's player displays
decorative 1080p/720p/480p menu entries, but those entries do not switch URLs
or represent master-playlist renditions. Do not infer quality from that menu.

The observed source carried the title's original audio. WatchFlux did not
publish an audio-language field in the source object. Subtitle data is
preserved when the shared resolver returns it.

## Why the provider does not fetch WatchFlux HTML

Direct requests to both supplied watch pages returned:

```text
HTTP 403
cf-mitigated: challenge
```

Standard headless Chrome remained on Cloudflare's “Just a moment” page. A
normal visible browser completed the challenge and exposed the server-rendered
player data, but requiring a browser would make the provider fragile and
unsuitable for ordinary API deployment.

The media HLS itself does not require WatchFlux cookies. It returned HTTP 200
from a normal server-side request with WatchFlux playback headers.

## Resolver request

The shared resolver uses:

```text
GET https://api.speedracelight.com/seed?mediaId=<tmdbId>
GET https://api.speedracelight.com/neon2/sources-with-title?<query>
```

The second request includes:

```text
title=<double-encoded title>
mediaType=movie|tv
year=<release year>
totalSeasons=<count>
episodeId=<episode number>
seasonId=<season number>
tmdbId=<TMDB ID>
imdbId=<IMDb ID>
enc=2
seed=<short-lived seed>
```

The response is decoded by the current Cineby payload decoder. See
[`CINEBY_MAINTENANCE.md`](./CINEBY_MAINTENANCE.md) for the seed lifetime,
cipher construction, API headers, response integrity check, and repair
procedure.

TMDB metadata is required to create the resolver query, so `TMDB_API_KEY` must
be configured.

## Playback

Returned links use:

```text
Origin: https://watchflux.tv
Referer: https://watchflux.tv/
User-Agent: browser-compatible UA
```

They are marked `requiresProxy: true`. Keep this enabled so master playlists,
child playlists, encryption keys, and media segments all flow through the
repository's HLS-rewriting proxy.

## Repair checklist

If WatchFlux stops returning streams:

1. Confirm the selected source on a current watch page is still named `neon`.
2. In a normal isolated browser, inspect `fullMedia.sources`, `sourcesStr`, and
   the video `<source>`.
3. Compare the direct URL with the Cineby Neon resolver result.
4. Fetch the master playlist and inspect its real `RESOLUTION` value.
5. If the resolver protocol changed, repair the shared Cineby implementation.
6. If WatchFlux moved to a different resolver, implement that resolver here
   instead of adding a browser dependency by default.
7. Verify both movie and episode endpoints.
8. Confirm the returned link remains proxied.

Do not make the decorative quality selector authoritative. The HLS master
playlist is the source of truth.
