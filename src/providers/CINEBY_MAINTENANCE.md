# Cineby provider maintenance reference

Last verified: **2026-07-24**

Implementation: [`cineby.ts`](./cineby.ts)  
Provider ID: `cineby`  
Website: `https://www.cineby.at`  
Current player API: `https://api.speedracelight.com`

This document records the Cineby behavior that was observed while implementing
the provider. It is intended to make future repairs possible even if the
website, API hostname, player servers, request headers, or payload cipher
changes.

> [!IMPORTANT]
> All domains, endpoints, headers, server names, response formats, and observed
> results in this document are a dated snapshot. Cineby is an external service
> and can change any of them without notice.

> [!CAUTION]
> Do not commit live seeds, Cloudflare cookies, proxy tokens, or signed media
> URLs. They are temporary, may contain access tokens, and are not useful as
> durable test fixtures. Use this integration only where access to the upstream
> content is authorized.

## Contents

1. [Architecture summary](#architecture-summary)
2. [Known website routes](#known-website-routes)
3. [Complete request flow](#complete-request-flow)
4. [TMDB metadata calls](#tmdb-metadata-calls)
5. [Cineby seed call](#cineby-seed-call)
6. [Player source calls](#player-source-calls)
7. [Player server map](#player-server-map)
8. [Required request headers](#required-request-headers)
9. [Encrypted payload format](#encrypted-payload-format)
10. [Decryption algorithm](#decryption-algorithm)
11. [Decrypted response schema](#decrypted-response-schema)
12. [Stream playback and proxying](#stream-playback-and-proxying)
13. [Repository integration](#repository-integration)
14. [Verified examples](#verified-examples)
15. [Expected failures](#expected-failures)
16. [Repair playbook](#repair-playbook)
17. [Testing checklist](#testing-checklist)
18. [Known limitations](#known-limitations)

## Architecture summary

Cineby's current playback pipeline has four distinct layers:

```text
TMDB metadata
    |
    v
api.speedracelight.com/seed
    |
    v
api.speedracelight.com/{server}/sources-with-title
    |
    | base64url + XOR-encrypted "mvm1" payload
    v
Local decoder
    |
    | signed HLS URLs + subtitle URLs
    v
FlixQuest stream proxy
    |
    | preserves Cineby Origin/Referer and rewrites HLS child URLs
    v
User/player
```

The website does **not** put the final media URL directly in the initial HTML.
It obtains TMDB-style metadata, requests a short-lived seed, queries several
player providers, decrypts their responses in the browser, and then passes the
resulting streams to its player.

The main operational domains observed were:

| Purpose                  | Domain                   | Notes                                                             |
| ------------------------ | ------------------------ | ----------------------------------------------------------------- |
| Website/player UI        | `www.cineby.at`          | Next.js application behind `ddos-guard`.                          |
| Encrypted source API     | `api.speedracelight.com` | Behind Cloudflare; browser-like cross-site headers are important. |
| Observed primary HLS CDN | `moon.ironwallnet.net`   | Hotlink protection requires Cineby's `Origin` and `Referer`.      |
| Observed fallback CDN    | `p4.vimeos.zip`          | Seen after repository-level validation; hostnames can rotate.     |
| Metadata                 | `api.themoviedb.org`     | Requires `TMDB_API_KEY`.                                          |

Do not create an allowlist containing only the two observed media hosts. Media
hosts are returned dynamically and are expected to rotate.

## Known website routes

Cineby uses the TMDB ID in its public page routes:

```text
https://www.cineby.at/movie/{tmdbId}?play=true
https://www.cineby.at/tv/{tmdbId}?play=true
```

Verified examples:

```text
https://www.cineby.at/movie/884605?play=true
https://www.cineby.at/tv/2316?play=true
```

For TV pages, `play=true` opened the default episode, which was season 1,
episode 1 in the verified example. The API provider must still receive explicit
season and episode values from FlixQuest.

Use the canonical `www.cineby.at` origin. During investigation, behavior from
bare/non-canonical domain variants was not as reliable.

## Complete request flow

The implementation follows this sequence:

1. Validate that `tmdbId` contains only digits.
2. For TV, validate that season and episode are positive integers.
3. Fetch title, release year, IMDb ID, and TV season count from TMDB.
4. Fetch a short-lived Cineby seed using the numeric TMDB ID.
5. Immediately query all configured Cineby player servers concurrently.
6. Base64url-decode and decrypt each successful response using:
   - the exact seed used in the request; and
   - the numeric TMDB ID.
7. Verify the decrypted `mvm1` magic prefix.
8. Parse the remaining UTF-8 bytes as JSON.
9. Normalize source quality and subtitle records.
10. Deduplicate sources by final URL.
11. Attach the required Cineby playback headers.
12. Set `requiresProxy: true`.
13. Sort adaptive/Auto and higher-resolution results before lower resolutions.
14. Let the repository's common stream validator remove expired, forbidden, or
    non-media candidates.

Metadata is fetched **before** the seed because the seed has a short TTL. All
source servers are queried concurrently so one slow secondary server does not
consume the seed before another server starts.

## TMDB metadata calls

Cineby's player API needs more than a TMDB ID. The provider first performs one
of these calls:

### Movie metadata

```http
GET https://api.themoviedb.org/3/movie/{tmdbId}
    ?api_key={TMDB_API_KEY}
    &append_to_response=external_ids
```

Fields used:

| TMDB field                              | Cineby parameter |
| --------------------------------------- | ---------------- |
| `title`                                 | `title`          |
| first four characters of `release_date` | `year`           |
| `external_ids.imdb_id`                  | `imdbId`         |
| not applicable                          | `totalSeasons=0` |

### TV metadata

```http
GET https://api.themoviedb.org/3/tv/{tmdbId}
    ?api_key={TMDB_API_KEY}
    &append_to_response=external_ids
```

Fields used:

| TMDB field                                | Cineby parameter |
| ----------------------------------------- | ---------------- |
| `name`                                    | `title`          |
| first four characters of `first_air_date` | `year`           |
| `external_ids.imdb_id`                    | `imdbId`         |
| `number_of_seasons`                       | `totalSeasons`   |

If `external_ids.imdb_id` is absent, the provider sends an empty `imdbId`.

The implementation currently uses a 15-second timeout for TMDB and Cineby
requests.

## Cineby seed call

The seed call must be made shortly before the source calls:

```http
GET https://api.speedracelight.com/seed?mediaId={tmdbId}
```

Example response shape:

```json
{
  "seed": "<short-lived opaque seed>",
  "ttlMs": 30000
}
```

Observed behavior:

- `mediaId` is the TMDB ID, not the IMDb ID.
- `seed` is an opaque string. Do not parse it or coerce it to a number.
- `ttlMs` was `30000`, or approximately 30 seconds.
- A seed should be treated as specific to the media ID.
- Fetch a new seed for every provider resolution.
- Do not cache it beyond the reported TTL.
- The exact same seed must be sent to the source endpoint and used by the
  local decoder.

A generic server-side request to this endpoint returned a Cloudflare HTML
challenge with HTTP 403. The browser-like API headers documented below changed
the same call to HTTP 200 JSON.

## Player source calls

All discovered source calls have this form:

```http
GET https://api.speedracelight.com/{server}/sources-with-title
    ?title={doubleEncodedTitle}
    &mediaType={movie|tv}
    &year={year}
    &totalSeasons={count}
    &episodeId={episode}
    &seasonId={season}
    &tmdbId={tmdbId}
    &imdbId={imdbId}
    &enc=2
    &seed={seed}
```

### Parameter reference

| Parameter      | Movie value             | TV value                 | Important details                                                                                                             |
| -------------- | ----------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `title`        | TMDB movie title        | TMDB show name           | Cineby's client pre-encodes this value before its request library encodes the full query. See the double-encoding note below. |
| `mediaType`    | `movie`                 | `tv`                     | Use exactly these values.                                                                                                     |
| `year`         | release year            | first-air year           | Four-character string.                                                                                                        |
| `totalSeasons` | `0`                     | TMDB `number_of_seasons` | Included for both media types.                                                                                                |
| `episodeId`    | `1`                     | requested episode number | This is the displayed episode number, not a TMDB episode ID.                                                                  |
| `seasonId`     | `1`                     | requested season number  | This is the displayed season number, not a TMDB season ID.                                                                    |
| `tmdbId`       | numeric TMDB ID         | numeric TMDB ID          | Also used as a number by the cipher.                                                                                          |
| `imdbId`       | IMDb ID or empty string | IMDb ID or empty string  | Obtained through TMDB `external_ids`.                                                                                         |
| `enc`          | `2`                     | `2`                      | Requests the encrypted response format currently used by the player.                                                          |
| `seed`         | current seed            | current seed             | Must match the seed supplied to the decoder.                                                                                  |

### Title double encoding

This is easy to accidentally break.

Cineby's client effectively performs:

```ts
url.searchParams.set('title', encodeURIComponent(title))
```

`URLSearchParams` then encodes the percent characters when serializing the
complete URL.

For example:

```text
Original title:       The Office
encodeURIComponent:  The%20Office
Serialized query:    title=The%2520Office
```

Do not simplify this to a single encoding unless a new network capture proves
that Cineby changed its client.

### Response transport

With `enc=2`, a successful endpoint returns an opaque base64url string rather
than the final JSON object. A large non-JSON response is therefore expected.

For The Office S1E1, Yoru returned:

- HTTP 200;
- approximately 28,524 encrypted characters at the time of testing; and
- a payload that decrypted into three HLS sources and 77 subtitles.

The response length is title-dependent and must not be used as a correctness
check.

### The misleading `/mbx` endpoint

During investigation, this endpoint was also found:

```text
https://api.speedracelight.com/mbx/sources-with-title
```

It belongs to a different/download-oriented path in the current Cineby client.
It returned:

```json
{
  "sources": [],
  "subtitles": []
}
```

for titles that played successfully through the website.

Do **not** use `/mbx/sources-with-title` as proof that Cineby has no playable
source. The active player path uses the encrypted endpoints listed below.

## Player server map

These names and language descriptions came from the live Cineby player
configuration. They describe the intended audio behavior, not a guarantee for
every title.

| Cineby name | Endpoint path                  | Intended audio/content                                | Current implementation                                         |
| ----------- | ------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------- |
| Yoru        | `cdn/sources-with-title`       | Original audio; Cineby noted that 4K may be available | Enabled; primary and most reliable in the verified examples    |
| Breach      | `m4uhd/sources-with-title`     | Original audio                                        | Enabled fallback                                               |
| Neon        | `neon2/sources-with-title`     | Original audio                                        | Enabled fallback                                               |
| Vyse        | `hdmovie/sources-with-title`   | English                                               | Enabled; keeps records whose source label is exactly `English` |
| Fade        | `hdmovie/sources-with-title`   | Hindi                                                 | Enabled; keeps records whose source label is exactly `Hindi`   |
| Killjoy     | `meine/sources-with-title`     | German                                                | Enabled                                                        |
| Omen        | `lamovie/sources-with-title`   | Spanish                                               | Enabled                                                        |
| Raze        | `superflix/sources-with-title` | Portuguese                                            | Enabled                                                        |

Vyse and Fade intentionally share an upstream endpoint and apply different
filters. This mirrors the observed player configuration.

Audio caveats:

- `Original audio` is title-dependent and does not necessarily mean English.
- Subtitle language does not identify stream audio.
- The current decrypted source schema usually exposes `quality` but no
  dependable audio-track field.
- For servers where Cineby uses the source `quality` field as a language label,
  the provider normalizes the displayed quality to `Auto`.
- Keep the intended audio in the `server` label so users can make an informed
  choice.

## Required request headers

### Source API headers

The seed and encrypted source endpoints currently use:

```http
Accept: */*
Accept-Language: en-US,en;q=0.9
Origin: https://www.cineby.at
Referer: https://www.cineby.at/
Sec-CH-UA: "Not.A/Brand";v="99", "Chromium";v="136"
Sec-CH-UA-Mobile: ?0
Sec-CH-UA-Platform: "macOS"
Sec-Fetch-Dest: empty
Sec-Fetch-Mode: cors
Sec-Fetch-Site: cross-site
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36
```

Why the extra browser headers exist:

- A basic `fetch`/`curl` request to the seed endpoint returned HTTP 403 and a
  Cloudflare HTML page.
- Adding the browser identity, origin, referer, and Fetch Metadata headers
  produced HTTP 200 JSON.
- Cloudflare rules change. If 403 returns, capture the current working browser
  request and update this set rather than blindly rotating user agents.

Header names are case-insensitive, but keep the current spelling for easier
comparison with DevTools.

### Playback headers

Every resolved media link currently carries:

```http
Accept: */*
Origin: https://www.cineby.at
Referer: https://www.cineby.at/
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36
```

Observed proof:

- The primary `.m3u8` returned HTTP 403 without the Cineby origin/referer.
- The same URL returned HTTP 200 with
  `Content-Type: application/vnd.apple.mpegurl` when these headers were sent.

Do not remove `requiresProxy: true`. Browser applications cannot reliably set
or preserve these headers for the manifest, child playlists, keys, and media
segments.

## Encrypted payload format

The encrypted endpoint response is:

1. base64url text;
2. decoded into raw bytes;
3. XORed with a deterministic keystream derived from the seed and numeric TMDB
   ID;
4. prefixed after decryption by four magic bytes;
5. followed by UTF-8 JSON.

Base64url normalization:

```text
- becomes +
_ becomes /
```

Node's `Buffer.from(value, "base64")` handles missing base64 padding.

Expected decrypted prefix:

```text
Hex:   6d 76 6d 31
ASCII: m  v  m  1
Text:  "mvm1"
```

If the first four decrypted bytes are not `mvm1`, do not attempt to treat the
remaining bytes as JSON. See the signature-mismatch diagnostics below.

## Decryption algorithm

The implementation is intentionally local and has no WASM or remote decryption
dependency.

### Constants

```text
GOLDEN_RATIO = 0x9e3779b9 = 2654435769
STATE_LENGTH = 61
INITIALIZATION_ROUNDS = 8
MAGIC = [0x6d, 0x76, 0x6d, 0x31]
```

All arithmetic state is unsigned 32-bit JavaScript arithmetic. Preserve
`Math.imul`, `>>> 0`, and rotation behavior when porting it.

### `mix32`

Conceptual pseudocode:

```text
value = uint32(value)
value ^= value >>> 16
value = uint32(imul(value, 0x85ebca6b))
value ^= value >>> 13
value = uint32(imul(value, 0xc2b2ae35))
value ^= value >>> 16
return uint32(value)
```

### Seed hash

The seed is hashed with an FNV-style loop and then mixed:

```text
hash = 0x811c9dc5
for every UTF-16 code unit in seed:
    hash = uint32(imul(hash XOR codeUnit, 0x01000193))
return mix32(hash)
```

Do not hash the media ID string here. The active algorithm hashes the opaque
seed string and separately mixes the numeric media ID.

### Initial state

```text
values = sparse array of length 61

accumulator = mix32(
    fnvHash(seed)
    XOR
    mix32(uint32(mediaId XOR GOLDEN_RATIO))
)

for round from 0 through 7:
    index = accumulator modulo 61
    accumulator = rotateLeft(
        uint32(accumulator + GOLDEN_RATIO),
        7 + (round AND 7)
    )
    values[index] = uint32(accumulator XOR mix32(accumulator))
    accumulator = mix32(uint32(accumulator + index))

accumulator = mix32(uint32(accumulator XOR 0xa5a5a5a5))
```

The sparse-array behavior matters. Reading an uninitialized slot produces
`undefined`, and `undefined >>> 0` becomes zero. The algorithm also uses
`index in values` to distinguish initialized from uninitialized entries.

### Generate one 32-bit word

For a monotonically increasing `counter` starting at zero:

```text
index = accumulator modulo 61
initializedMask = -1 if index exists in values, otherwise 0
value = uint32(values[index])
counterValue = uint32(imul(GOLDEN_RATIO, counter + 1))

combined = uint32(
    (accumulator XOR (value XOR counterValue))
    OR
    (accumulator AND (value XOR counterValue) AND initializedMask)
)

word = uint32(
    rotateLeft(uint32(combined + accumulator), index AND 31)
    XOR
    rotateLeft(accumulator, imul(index, 7) AND 31)
)

accumulator = mix32(uint32(word + GOLDEN_RATIO))
values[index] = accumulator
return accumulator
```

### Convert words into the keystream

Each generated 32-bit word is written little-endian:

```text
byte 0 = word & 0xff
byte 1 = (word >>> 8) & 0xff
byte 2 = (word >>> 16) & 0xff
byte 3 = (word >>> 24) & 0xff
```

Continue until the keystream has the same number of bytes as the encrypted
payload.

### Decrypt and parse

```text
encryptedBytes = base64urlDecode(responseText.trim())
keystream = createKeystream(seed, numericTmdbId, encryptedBytes.length)

for every byte index:
    encryptedBytes[index] ^= keystream[index]

assert encryptedBytes starts with ASCII "mvm1"
jsonBytes = encryptedBytes after the first 4 bytes
jsonText = strict UTF-8 decode(jsonBytes)
payload = JSON.parse(jsonText)
```

The inspected site bundle contained obfuscation and opaque predicates around
the cipher. The repository implementation records the active path that
successfully decoded live movie and TV payloads. If the signature starts
failing for every title with fresh seeds, re-extract the active algorithm from
the latest player bundle rather than assuming every apparent branch is real.

## Decrypted response schema

The current payload shape is:

```ts
interface CinebyPayload {
  sources?: Array<{
    url?: string
    file?: string
    quality?: string
    label?: string
    title?: string
  }>
  subtitles?: Array<{
    url?: string
    file?: string
    lang?: string
    language?: string
    label?: string
  }>
  tracks?: Array<{
    url?: string
    file?: string
    lang?: string
    language?: string
    label?: string
  }>
}
```

Observed live source record, with URL removed:

```json
{
  "quality": "1080p",
  "url": "<signed HLS URL>"
}
```

Observed live subtitle record, with URL removed:

```json
{
  "lang": "English",
  "language": "English",
  "url": "<signed subtitle URL>"
}
```

Normalization rules:

- Source URL preference: `url`, then `file`.
- Source label preference: `quality`, then `label`, then `title`.
- Subtitle URL preference: `url`, then `file`.
- Subtitle label preference: `language`, then `lang`, then `label`.
- Only `http:` and `https:` sources are accepted.
- Subtitle entries are deduplicated by URL plus label.
- Source entries are deduplicated by URL across all Cineby servers.
- Known numeric qualities normalize to `2160p`, `1080p`, `720p`, `480p`, or
  `360p`.
- A language value in the source quality field normalizes to `Auto`.
- Other upstream labels, such as `Vimeos` or `Voesx`, are currently preserved.

## Stream playback and proxying

Every output link is a normal repository `ProviderLink`:

```ts
{
  server: `Cineby | ${serverName} | ${intendedAudio} | ${index}`,
  url: resolvedUrl,
  isM3U8: trueOrFalse,
  quality: normalizedQuality,
  subtitles,
  headers: PLAYBACK_HEADERS,
  requiresProxy: true
}
```

The proxy requirement is not optional for the currently observed HLS host.

The repository flow is:

1. `cinebyProvider` returns upstream links with Cineby playback headers.
2. The API sees `requiresProxy: true`.
3. [`stream-proxy.ts`](../utils/stream-proxy.ts) signs the upstream URL and
   header set into a local `/proxy?token=...` URL.
4. The proxy requests the HLS manifest with the required upstream headers.
5. It rewrites:
   - non-comment playlist lines;
   - nested `.m3u8` URLs;
   - segment URLs;
   - encryption-key URLs in `URI="..."` attributes; and
   - other HLS URI attributes
     into signed proxy URLs carrying the same header set.
6. The common stream validator performs a ranged GET and removes inaccessible
   or HTML responses.

Environment variables involved:

| Variable              | Required             | Purpose                                               |
| --------------------- | -------------------- | ----------------------------------------------------- |
| `TMDB_API_KEY`        | Yes                  | Metadata lookup; also acts as proxy-signing fallback. |
| `STREAM_PROXY_SECRET` | Strongly recommended | Dedicated HMAC secret for signed proxy tokens.        |

Use a dedicated `STREAM_PROXY_SECRET` in production rather than relying on the
TMDB key fallback.

The current stream proxy token lifetime is six hours, but that does not extend
the lifetime of Cineby's upstream signed URL. Always resolve Cineby on demand
and do not persist returned links.

## Repository integration

Primary files:

| File                                                             | Responsibility                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [`cineby.ts`](./cineby.ts)                                       | Metadata lookup, API headers, server definitions, seed fetch, decryption, normalization, and provider export |
| [`index.ts`](./index.ts)                                         | Registers provider ID `cineby`                                                                               |
| [`../utils/stream-validation.ts`](../utils/stream-validation.ts) | Validates resolved/proxied media URLs                                                                        |
| [`../utils/stream-proxy.ts`](../utils/stream-proxy.ts)           | Preserves hotlink headers and rewrites HLS playlists                                                         |
| [`../types/index.ts`](../types/index.ts)                         | `Provider`, `ProviderLink`, and `Subtitle` contracts                                                         |

Important implementation functions in `cineby.ts`:

| Function            | Role                                                                    |
| ------------------- | ----------------------------------------------------------------------- |
| `fetchMediaDetails` | Fetches title/year/IMDb ID/season count from TMDB                       |
| `fetchSeed`         | Obtains the current short-lived Cineby seed                             |
| `fetchServer`       | Constructs one encrypted player-provider request                        |
| `decodePayload`     | Base64url decoding, keystream XOR, magic verification, and JSON parsing |
| `initializeCipher`  | Initializes the 61-slot cipher state                                    |
| `nextCipherWord`    | Evolves state and produces one 32-bit keystream word                    |
| `createKeystream`   | Converts words to little-endian bytes                                   |
| `formatSubtitles`   | Normalizes and deduplicates captions                                    |
| `formatLinks`       | Creates proxy-required `ProviderLink` records                           |
| `getStreams`        | Validation, orchestration, fallbacks, deduplication, and sorting        |

The provider intentionally catches individual server failures. A broken
secondary must not discard successful Yoru or other fallback results.

## Verified examples

All results in this section were observed on **2026-07-24** and are diagnostic
anchors, not permanent availability guarantees.

### TV: The Office S1E1

Metadata:

```text
TMDB ID:       2316
IMDb ID:       tt0386676
Title:         The Office
Year:          2005
Total seasons: 9
Season:        1
Episode:       1
```

Direct Yoru payload:

```text
Endpoint:      /cdn/sources-with-title
HTTP status:   200
Cipher length: approximately 28,524 characters
Sources:       3
Qualities:     1080p, 720p, 480p
Subtitles:     77
Format:        HLS (.m3u8)
Observed host: moon.ironwallnet.net
```

Subtitle labels included:

```text
English, Arabic, Hebrew, Italian, Polish, Croatian, Indonesian, Persian,
Spanish, French, Korean, Bosnian, Portuguese (BR), Finnish, Estonian,
Japanese, Portuguese, German, and additional languages
```

Repository-level result:

```text
Raw candidates:       5
Validated candidates: 4
Validated qualities:  1080p, 720p, 480p, Vimeos
Observed hosts:        moon.ironwallnet.net, p4.vimeos.zip
API status:            HTTP 200
API provider ID:       cineby
Returned URLs:         local signed /proxy URLs
```

Server behavior during that run:

| Server  | Observed result                        |
| ------- | -------------------------------------- |
| Yoru    | Successful                             |
| Killjoy | Successful candidate(s)                |
| Omen    | Successful candidate(s)                |
| Breach  | HTTP 500                               |
| Neon    | Timed out in one run                   |
| Vyse    | HTTP 500                               |
| Fade    | Timed out or HTTP 500 depending on run |
| Raze    | HTTP 500                               |

This is normal multi-provider behavior. Do not require every server to succeed.

### Movie: TMDB 884605

Raw provider result:

```text
Candidates:       7
Qualities/labels: Auto, 2160p, 1080p, 720p, 480p, Vimeos, Voesx
Server families:  Yoru, Killjoy, Omen
Subtitles:        up to 124 on the primary payload
Proxy required:   yes for every candidate
```

### Local API test routes

```text
GET /v2/stream-tv?tmdbId=2316&season=1&episode=1&provider=cineby
GET /v2/stream-movie?tmdbId=884605&provider=cineby
GET /v2/providers
```

The TV route was tested end to end through the local Express API and HLS proxy,
not only by calling `cinebyProvider` directly.

## Expected failures

### Seed call returns HTTP 403 with HTML

Likely causes:

- API headers no longer match the working browser request.
- Cloudflare changed its policy.
- `Origin` or `Referer` is missing.
- User-Agent and Client Hint headers contradict each other.
- The API hostname changed.
- The server/IP is regionally challenged.

Actions:

1. Open a working Cineby page in a normal browser.
2. Filter DevTools Network for `/seed`.
3. Compare URL, status, request headers, and response content type.
4. Copy only stable header requirements into `API_HEADERS`.
5. Do not commit Cloudflare cookies as a permanent solution.

### Source endpoint returns HTTP 500

This commonly indicates failure of that specific Cineby upstream, not a broken
seed or decoder.

Actions:

- Confirm whether Yoru or another server succeeds.
- Keep per-server error isolation.
- Compare the failing server against Cineby's current player server list.
- Remove an endpoint only if the website removed it, not because one title
  returned 500.

### Source endpoint times out

Some secondary endpoints hung until the 15-second timeout during verification.

Actions:

- Keep all server calls concurrent.
- Retain an abort timeout.
- Consider a smaller per-server timeout only after measuring catalog impact.
- Do not make fallbacks sequential; doing so can outlive the seed TTL.

### Payload signature mismatch

The error is:

```text
Cineby payload signature mismatch
```

Most likely causes, in order:

1. The seed expired before the response was decoded.
2. A different seed was used for the request and decoder.
3. The wrong TMDB ID was converted to the numeric cipher media ID.
4. The endpoint returned an HTML/error body with HTTP 200.
5. `enc` changed from `2`.
6. Cineby changed the cipher or magic prefix.
7. The title/query format caused a different response mode.

Diagnostics:

- Log status, content type, response length, and first few **encrypted**
  characters only.
- Never log the decrypted payload or signed source URLs in production.
- Fetch a new seed and retry one known-good Yoru title.
- Check for the current magic bytes in the newest player bundle.
- Compare `mix32`, seed hashing, state size, initialization rounds, word
  evolution, and output byte order.

### Decryption succeeds but JSON parsing fails

Likely causes:

- The magic length changed.
- The JSON is compressed or wrapped.
- UTF-8 decoding behavior changed.
- Extra bytes were inserted before/after the object.
- The algorithm is almost, but not completely, correct.

Inspect the bytes after the magic as a safe escaped prefix. Do not dump the
whole payload because it contains signed URLs.

### Payload contains zero sources

Check:

- Was `/mbx/sources-with-title` used accidentally?
- Is `title` double-encoded?
- Are `mediaType`, year, season, episode, TMDB ID, and IMDb ID correct?
- Is `totalSeasons` present for TV?
- Does the title play on Cineby in the same region?
- Did the server return only a language label filtered out by Vyse/Fade?
- Are records now under a different property than `sources`?

### HLS URL returns HTTP 403

Likely cause: missing Cineby playback headers.

Check that all of these reach the upstream request:

```text
Origin
Referer
User-Agent
```

Also confirm that:

- `requiresProxy` is still `true`;
- the API returned a local `/proxy` URL;
- the proxy token includes the headers;
- nested playlists, keys, and segments are rewritten through the proxy; and
- the upstream signed URL has not expired.

### API returns candidates but FlixQuest returns 404

The common validator may have removed every candidate because:

- URLs expired between extraction and validation;
- upstream returned HTML;
- required headers were missing;
- the media host blocked the server region/IP; or
- content type/extension no longer looks like supported media.

Compare raw provider output with `getProvider("cineby")`, which includes common
validation.

### Cineby page becomes `about:blank` in headless Chrome

The live site detected the stock automated/headless browser used during
investigation and navigated to `about:blank`, even after basic
`navigator.webdriver` and User-Agent overrides.

Implications:

- Do not make a browser dependency part of this provider.
- Use a normal interactive browser for repair captures if the page works there.
- The API and local decoder path is more reliable than trying to automate the
  full UI.

## Repair playbook

Follow these steps in order when Cineby breaks.

### 1. Reproduce with known movie and TV cases

Start with:

```text
TV:    TMDB 2316, season 1, episode 1
Movie: TMDB 884605
```

Then add a recently released title. A single old title disappearing is not
enough evidence that the integration is broken.

Classify the first failure:

```text
TMDB metadata
seed request
source request
payload signature
JSON/schema
manifest validation
segment playback
```

Do not change the cipher when the real failure is a 403 header challenge or an
expired media URL.

### 2. Inspect the current browser network

In a normal browser:

1. Open `https://www.cineby.at/tv/2316?play=true`.
2. Select season 1, episode 1 if needed.
3. Open DevTools Network.
4. Enable Preserve log.
5. Filter for:
   - `seed`;
   - `sources-with-title`;
   - `m3u8`;
   - `manifest`;
   - `playlist`.
6. Record:
   - API hostname;
   - endpoint path;
   - query parameter names and values;
   - request headers;
   - response status and content type;
   - which provider name was selected;
   - whether the response is JSON, base64url text, hex, or binary.
7. Do not copy live cookies or signed URLs into this document.

### 3. Inspect the current Next.js bundles

At the time of the original investigation, useful historical anchors were:

```text
Next.js build ID:
s9Ry7AaMpvRzFxSackZ1r

Player chunks:
/_next/static/chunks/4123.14312fc1573ce6f2.js
/_next/static/chunks/6292.692b5a5e09abc24a.js

Observed module roles:
50882 - player provider configuration/request orchestration
84737 - encrypted request/decoder logic
```

These hashes and numeric module IDs are build artifacts and will change. Never
hardcode them into the provider.

Repair discovery approach:

1. Fetch the current page HTML.
2. Extract its `/_next/static/...js` script URLs.
3. Read the Webpack runtime to discover lazy chunks if needed.
4. Search current chunks for:

```text
sources-with-title
speedracelight
/seed
mediaId
enc
mvm1
ttlMs
totalSeasons
```

5. Find the provider configuration and request helper.
6. Compare the current endpoints and filters with `SERVERS`.
7. Compare the active decoder with the functions in `cineby.ts`.

The original player provider logic appeared in two chunks, likely because of
code splitting/duplication. Search all loaded chunks rather than stopping at
the first match.

### 4. Verify calls independently

Test in increasing order:

```text
TMDB metadata -> seed -> Yoru encrypted response -> decode -> manifest
```

Yoru is the best first server because it was the most reliable observed path.
Only after Yoru works should you spend time on secondary providers.

For every stage, log metadata rather than secrets:

```text
HTTP status
content type
body length
payload keys
source count
subtitle count
quality labels
media hostnames
```

Redact:

```text
seed values
signed URL paths and query strings
proxy tokens
cookies
subtitle signed URLs
```

### 5. Update the smallest broken layer

Examples:

- Domain change: update `CINEBY_API_BASE`.
- Canonical-site change: update `CINEBY_ORIGIN`, API headers, and playback
  headers together.
- Cloudflare/header change: update `API_HEADERS`.
- Server change: update `SERVERS`.
- Query change: update `fetchServer`.
- Seed response change: update `SeedResponse` and `fetchSeed`.
- Cipher change: update only the cipher/decode functions.
- Schema change: update `CinebyPayload`, `formatSubtitles`, and `formatLinks`.
- CDN hotlink change: update `PLAYBACK_HEADERS` and confirm proxy rewriting.

Avoid replacing the whole provider when only one layer changed.

### 6. Preserve failure isolation

The expected behavior is:

```text
one server fails -> warn -> keep results from other servers
all servers fail -> return []
metadata/seed fails -> return []
```

Do not change `Promise.allSettled` to `Promise.all`, because one HTTP 500 would
then discard every successful source.

### 7. Revalidate end to end

A repair is not complete when JSON contains an `.m3u8` URL. Confirm:

1. the raw provider returns links;
2. common stream validation keeps at least one;
3. the Express endpoint returns HTTP 200;
4. the user-facing link points to local `/proxy`;
5. the proxied manifest returns an HLS content type;
6. a child playlist or segment can be requested; and
7. no signed upstream URLs leak into logs or committed fixtures.

## Testing checklist

### Static checks

```bash
pnpm exec prettier --check src/providers/cineby.ts
pnpm typecheck
pnpm build
pnpm lint
git diff --check
```

If full-repository lint fails in an unrelated provider, also lint Cineby
directly so its result is unambiguous:

```bash
pnpm exec eslint src/providers/cineby.ts src/providers/index.ts
```

### Start the API

```bash
pnpm dev
```

Confirm registration:

```http
GET /v2/providers
```

The response should include:

```json
{
  "id": "cineby",
  "name": "Cineby"
}
```

### TV test

```http
GET /v2/stream-tv?tmdbId=2316&season=1&episode=1&provider=cineby
```

Expected structural assertions:

- HTTP 200 when at least one upstream is healthy.
- `success` is `true`.
- `provider` is `cineby`.
- `links` is non-empty.
- every returned link is a local `/proxy` URL;
- every link has `requiresProxy: true` in raw provider output;
- known Yoru results may include 1080p, 720p, and 480p;
- subtitles are arrays with `file`, `label`, and `kind`.

### Movie test

```http
GET /v2/stream-movie?tmdbId=884605&provider=cineby
```

Expected structural assertions are the same as TV. Do not require 2160p in an
automated test because availability can change.

### Negative tests

Exercise:

```text
non-numeric TMDB ID
season 0
episode 0
missing TMDB_API_KEY
expired seed
wrong seed
wrong media ID during decryption
HTML response instead of cipher text
malformed base64url
valid magic with malformed JSON
source with unsupported protocol
duplicate source URL
duplicate subtitle URL/label
manifest without playback headers
```

The provider contract returns an empty link array for top-level operational
failure and logs a concise diagnostic. It should not expose seeds or source
URLs in those diagnostics.

## Known limitations

- Cineby and its upstreams are external and undocumented.
- Server names and API paths are implementation details, not stable public API.
- Availability varies by title, episode, region, and server IP.
- Some secondary providers regularly return HTTP 500 or time out.
- Spoken language is not consistently present in decrypted source metadata.
- Server audio labels reflect Cineby's player configuration, not media probing.
- Subtitles can be extensive, but they do not imply matching audio tracks.
- Signed streams are short-lived and must not be cached as catalog data.
- Cloudflare can reject data-center traffic even when browser traffic works.
- A working manifest does not guarantee every segment remains available.
- Full UI automation is fragile because the site detected headless Chrome.
- The current provider depends on TMDB metadata and cannot work without a
  configured `TMDB_API_KEY`.
- The decoder is coupled to JavaScript unsigned 32-bit semantics. Ports to
  languages with different integer behavior require explicit wrapping.
- The provider does not inspect HLS audio renditions to verify spoken language.
- The provider preserves unfamiliar quality/host labels instead of guessing a
  resolution.

When updating this document, change the verification date and clearly separate
new live observations from historical behavior.
