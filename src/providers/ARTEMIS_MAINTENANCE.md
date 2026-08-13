# ZStream Artemis provider: current protocol

Last verified: **2026-08-13**

Provider ID: `artemis`  
Implementation: [`artemis.ts`](./artemis.ts)  
Public site: <https://zstream.mov/>

Z-Stream still labels this source **Artemis** in its public source list, but
the backend has moved twice since the original `artemis.fontaine.lol/lookup`
encrypted protocol: first to the **Celestial** content CDN
(`cdn.fontaine.lol/content/...`), and now to the **Vault** aggregator on
`stream.fontaine.lol`. The old Celestial `/content/` endpoint stopped serving
content (it returns `404 {"found":false}` for every lookup) and the provider
now follows the live Vault protocol.

## Current request flow

The Vault keys media by **IMDb id**, so the provider first resolves the IMDb
id from TMDB (`/movie/{tmdbId}` for movies, `/tv/{tmdbId}/external_ids` for
shows). A missing TMDB key or a failed id lookup only means the Vault cannot
serve that title; the provider then returns no links.

```text
GET https://stream.fontaine.lol/vault?tmdbId=<tmdbId>&imdbId=<imdbId>&type=movie
GET https://stream.fontaine.lol/vault?tmdbId=<tmdbId>&imdbId=<imdbId>&type=tv&seasonId=<season>&episodeId=<episode>
```

`seasonId`/`episodeId` use the human numbering values. The request sends a
Z-Stream `Referer` and a browser `User-Agent`. No signatures, encrypted query
parameters, cookies, or Turnstile tokens are required.

A successful response has this shape (each source entry holds an object):

```json
{
  "sources": {
    "Quartz": { "url": "https://.../master.m3u8", "type": "hls" },
    "Andesite": { "url": "https://.../movie.mp4", "type": "mp4" }
  }
}
```

The provider exposes one link per source, named
`ZStream | Vault · <source>`, with HLS/DASH detection from the `type` field
or the URL extension, empty subtitles, Z-Stream playback headers, and
`requiresProxy: true`.

Error handling:

- HTTP `400` (for example `{"detail":"vault: imdbId is required"}`) and
  `404` mean the title is unavailable; the provider returns no links.
- Any other non-2xx response raises an error so the API can report failure.

## Known issues

- The Vault worker intermittently answers with Cloudflare `502 error code`
  while its upstream aggregators (Quartz/Andesite) are down. This mirrors
  what real users of zstream.mov see and is not a provider bug.
- There is a separate VIP-only Artemis source (`artemisVipKey` in the client
  bundle) that requires a per-account `X-API-Key`; it is intentionally not
  implemented.

## Repair checklist

1. Open <https://zstream.mov/> and locate its current `vendor` asset.
2. Find the `vault` source (`scrapeMovie`/`scrapeShow` pointing at
   `stream.fontaine.lol` or a new host) and compare the request and response
   shape with the sections above.
3. Update the endpoint builder and `VaultResponse` interface in
   `artemis.ts` if either changed.
4. Run the provider tests and both live endpoints below.
5. Confirm any returned URL serves an HLS manifest rather than HTML.

Useful direct checks:

```bash
curl 'http://localhost:3000/api/v2/stream-movie?tmdbId=884605&provider=artemis'
curl 'http://localhost:3000/api/v2/stream-tv?tmdbId=2316&season=1&episode=1&provider=artemis'
```

The provider needs no API key, cookie, Cloudflare clearance, or browser
automation as of the verification date; only the TMDB key for the IMDb-id
lookup.
