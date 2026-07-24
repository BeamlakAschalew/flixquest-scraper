# WatchFlux provider maintenance

Last verified: **2026-07-24**

Provider ID: `watchflux`  
Implementation: [`watchflux.ts`](./watchflux.ts)  
Site: <https://watchflux.tv/>

## Required configuration

WatchFlux protects watch pages with a Cloudflare managed challenge. Configure
the clearance value from a browser that can open WatchFlux:

```env
WATCHFLUX_CF_CLEARANCE=the_cookie_value_only
WATCHFLUX_USER_AGENT=the_exact_user_agent_from_that_browser
```

`WATCHFLUX_CF_CLEARANCE` may optionally include the `cf_clearance=` prefix.
Never commit either value. The cookie is HttpOnly session material and may be
bound to the browser User-Agent and public IP.

The cookie observed during the 2026-07-24 investigation had an expiry roughly
one year in the future, but Cloudflare can revoke or replace it sooner.

## Obtaining the values

1. Open a normal visible browser with an isolated profile.
2. Visit <https://watchflux.tv/watch/movie/884605>.
3. Allow the Cloudflare verification to finish.
4. In browser developer tools, find the `cf_clearance` cookie for
   `.watchflux.tv`.
5. Copy its value to `WATCHFLUX_CF_CLEARANCE`.
6. In the same browser console, evaluate:

```js
navigator.userAgent
```

7. Copy the result exactly to `WATCHFLUX_USER_AGENT`.

Do not log, publish, or commit the cookie. Refresh both values when the provider
reports that clearance was rejected.

## Request flow

Movie:

```text
GET https://watchflux.tv/watch/movie/<tmdbId>
Cookie: cf_clearance=<configured value>
User-Agent: <matching configured value>
```

TV episode:

```text
GET https://watchflux.tv/watch/tv/<tmdbId>/season/<season>/episode/<episode>
Cookie: cf_clearance=<configured value>
User-Agent: <matching configured value>
```

The response is server-rendered HTML. No second player API request is required.

## Player data

WatchFlux places URL-encoded JSON in inline JavaScript:

```js
let fullMediaStr = '<percent-encoded JSON>'
let sourcesStr = '<percent-encoded JSON>'
```

`sourcesStr` is the authoritative source list. The confirmed shape is:

```json
[
  {
    "service": "neon",
    "url": "https://<uwucdn-host>/<opaque-id>/playlist.m3u8",
    "type": "direct"
  }
]
```

`fullMediaStr` also contains:

```json
{
  "videoUrl": "https://<uwucdn-host>/<opaque-id>/playlist.m3u8",
  "sources": [],
  "subtitles": []
}
```

The provider decodes both variables, uses `sourcesStr` when present, and maps
any subtitle objects from `fullMediaStr`.

## Confirmed examples

Pages:

```text
https://watchflux.tv/watch/movie/884605
https://watchflux.tv/watch/tv/2316/season/9/episode/1
```

API endpoints:

```text
GET /v2/stream-movie?tmdbId=884605&provider=watchflux
GET /v2/stream-tv?tmdbId=2316&season=9&episode=1&provider=watchflux
```

Both pages returned HTTP 200 through a server-side request using the approved
clearance cookie and matching User-Agent. Each contained exactly one `neon`
source.

The opaque source URL and even its CDN hostname can change between page loads.
Never cache or hard-code a captured URL.

## Quality

Both supplied HLS master playlists returned:

```m3u8
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720
hls/playlist.m3u8
```

The verified quality is therefore **720p**.

WatchFlux displays decorative 1080p, 720p, and 480p entries in its settings
menu, but those entries do not represent separate HLS renditions. Do not use
that menu as quality evidence.

## Audio and subtitles

The source object does not declare an audio language. The observed title used
its original audio. Do not label all WatchFlux results as English.

Subtitle objects, when present, are read from `fullMediaStr.subtitles` and
normalized into the repository subtitle contract.

## Playback

The extracted HLS master playlists responded directly without WatchFlux
cookies. Playback uses:

```text
Origin: https://watchflux.tv
Referer: https://watchflux.tv/
User-Agent: <configured browser UA>
```

Links remain marked `requiresProxy: true`, ensuring child playlists, media
segments, and encryption keys are rewritten through the API proxy.

## Cloudflare failure behavior

Without valid clearance, WatchFlux responds with:

```text
HTTP 403
cf-mitigated: challenge
```

The body title is `Just a moment...`.

Standard headless Chrome did not pass the challenge during testing. Normal
visible Chrome did. The provider deliberately does not attempt to solve or
bypass Cloudflare; it only reuses user-supplied clearance from an authorized
browser session.

If clearance is missing or rejected, the provider logs an actionable error and
returns no candidates.

## Repair checklist

1. Confirm the browser can still open the supplied pages.
2. Refresh `WATCHFLUX_CF_CLEARANCE` and the matching User-Agent.
3. Confirm a cookie-authenticated page request returns HTTP 200.
4. Search the HTML for `sourcesStr`.
5. Percent-decode and JSON-parse the variable.
6. Confirm the source is still `type: "direct"`.
7. Inspect the HLS master playlist for its actual resolution.
8. Verify both movie and episode routes.
9. Confirm returned streams remain proxied.
10. Never commit session cookies or captured opaque HLS URLs.
