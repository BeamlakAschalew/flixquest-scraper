# ZStream (Fontaine) provider maintenance

Last verified: **2026-08-13**

Provider ID: `zstream`  
Implementation: [`zstream.ts`](./zstream.ts)  
Public site: <https://zstream.mov/>

The `zstream` provider aggregates the remaining public Fontaine sources of
zstream.mov. These run on `https://stream.fontaine.lol`:

| Source     | Endpoint   | Protocol                                       |
| ---------- | ---------- | ---------------------------------------------- |
| Vault 🔐   | `/vault`   | plain query, keyed by IMDb id                  |
| Shibuya 🌸 | `/shibuya` | signed request + AES-GCM encrypted stream URLs |
| Neko 🐱    | `/Neko`    | signed request + AES-GCM encrypted stream URL  |

Vault is a plain lookup. Shibuya and Neko validate every request with a
per-request proof that ZStream derives from a fixed key schedule bundled in
its client (also used by the VIP Artemis source, which additionally needs a
per-account `X-API-Key` and is therefore not implemented).

## Signed request protocol (Shibuya and Neko)

The client derives a deterministic key stream:

```text
seed        = sha256("pstream-prelude-token-mix-v1:localhost")
keystream   = sha256(seed || [0]) || sha256(seed || [1]) || ...   (32 bytes)
sigKey      = KY XOR keystream        (56 bytes)
encKey      = BY XOR keystream        (32 bytes)
shortKey    = QY XOR keystream        (56 bytes)
bucket      = floor(unix_seconds / 10800)     (3-hour window)
X-PS-Sig    = hex(hmac-sha256(sigKey, "{tmdb}|{season}|{episode}|{bucket}"))
z           = hex(hmac-sha256(shortKey, "{tmdb}:{bucket}"))[0:10]
_pk         = hex(iv12 || aes-256-gcm(encKey, iv, JSON{t, x, n}))
```

`KY`, `BY` and `QY` are fixed 56/32/56-byte key masks; `x` is the current
unix time in seconds and `n` a random hex nonce. The request then sends:

```text
GET /shibuya?type=movie|tv&tmdbId=<id>[&imdbId=<id>][&t=<title>][&ry=<year>][&seasonId=<n>&episodeId=<n>]&_pk=<pk>&z=<z>
    X-PS-Sig: <signature>
GET /Neko?type=movie|tv&tmdbId=<id>[&seasonId=<n>&episodeId=<n>]&_pk=<pk>&z=<z>
    X-PS-Sig: <signature>
```

Neko and Shibuya respond with encrypted stream URLs. Neko wraps one URL in
`sources.Neko.url` with an `nk_` prefix; Shibuya returns a `streams` array
whose `url` values carry an `sb_` prefix. Strip the three-character prefix,
hex-decode the rest and decrypt with AES-256-GCM:

- Neko key: `91c818cf3d725fba7dee5af0bc2be19893ff7b4bb1159cd80e92637a74bcb5f3`
- Shibuya key: `0e8601be4cbcfb2c79dd5dd3d0d4563d5c89d2962c89263e5e8416583119c6fa`

The decrypted value is the playable HLS URL. Neko responses also include the
required playback headers (typically a `purstream.club` Referer plus a
Windows Chrome user agent); the provider forwards them on the link.

## Vault

Plain request, no signature:

```text
GET /vault?tmdbId=<id>&imdbId=<id>&type=movie
GET /vault?tmdbId=<id>&imdbId=<id>&type=tv&seasonId=<n>&episodeId=<n>
```

Response: `{ "sources": { "<name>": { "url": "...", "type": "..." } } }`.
Each entry becomes one provider link. The Vault intermittently answers with
Cloudflare `502 error code` while its origin is overloaded; that mirrors the
live site and is not a provider bug.

## Known limitations

- Shibuya currently reports `{"detail":"shibuya: no streams"}` for every
  tested title while its catalog is (re)populated. It is kept in the probe
  so it starts contributing automatically.
- The VIP Artemis source (`artemisvip.fontaine.lol`, rank 9999) requires a
  per-account API key and is intentionally not implemented.
- The CIA API source (`febbox.andresdev.org/m/{imdb}` and
  `/tv/{imdb}/season/{n}/episode/{n}` with a `ui-token` header) no longer
  resolves — the domain returns NXDOMAIN, which is why the live client
  disables it. When it existed it consumed the same FebBox `ui` token that
  `showbox.ts` uses as its `ui=` cookie (token value without the prefix).
- Finger API runs on `backend.xprime.tv` (also unreachable) and FED API
  requires a browser-side Turnstile token, so neither can be served
  server-side.

## Subtitles

Fontaine sources do not expose separate subtitle tracks. Neko's HLS masters
carry native `EXT-X-MEDIA:TYPE=SUB` renditions which players extract from
the playlist directly. The API's fallback subtitle providers cover the rest.

## Repair checklist

1. Open <https://zstream.mov/> and locate its current `vendor` asset.
2. Find the `vault`, `shibuya` and `neko` sources (`Qr({...})` entries) and
   compare their request/response handling with the sections above.
3. If a key or endpoint changed, update the constants and builders in
   `zstream.ts`.
4. Run the endpoints below and confirm at least one HLS URL is returned.

Useful direct checks:

```bash
curl 'http://localhost:3000/api/v2/stream-movie?tmdbId=634649&provider=zstream'
curl 'http://localhost:3000/api/v2/stream-tv?tmdbId=2316&season=1&episode=1&provider=zstream'
```

The provider needs no API key, cookie, Cloudflare clearance, or browser
automation; only the TMDB key for the IMDb-id/title lookups.
