# ZStream Artemis provider: protocol and repair guide

Last verified: **2026-07-24**

Provider ID: `artemis`  
Implementation: [`artemis.ts`](./artemis.ts)  
Public site: <https://zstream.mov/>  
Lookup API observed in production: <https://artemis.fontaine.lol/lookup>

This document records the live protocol used by ZStream's **Artemis [4K]**
source. Artemis is not an iframe extractor. The ZStream browser application
creates several short-lived cryptographic proofs, calls an encrypted lookup
API, decrypts the reply, and then plays one of the returned variants.

The protocol is intentionally obfuscated and all domains, keys, time windows,
field names, or response shapes can change without notice. The constants in
this file are public client-side material, not user credentials.

## User-facing characteristics

- 🌐 **Catalog:** movies and episodic TV, addressed by TMDB ID.
- 🗣️ **Audio:** whatever audio track the returned file contains. The lookup
  metadata does not currently declare an audio language, so do not label every
  result as English.
- 🎞️ **Quality:** the source advertises up to 4K. The provider reports the
  lookup response's `quality` value and does not manufacture a resolution.
- 💬 **Subtitles:** Artemis's lookup variant schema did not expose subtitle
  tracks during this investigation. The provider therefore returns an empty
  subtitle list.
- 🔐 **Playback:** links remain behind this API's stream proxy because upstream
  hosts may check `Origin`, `Referer`, expiry parameters, or other signatures.

## Confirmed test media

The URLs supplied during the investigation were:

- Movie, TMDB `884605`:
  <https://zstream.mov/media/tmdb-movie-884605-no-hard-feelings>
- TV, TMDB `2316`, The Office:
  <https://zstream.mov/media/tmdb-tv-2316-the-office/7240/170135>

The last two path components in the website's TV URL are ZStream/TMDB season
and episode resource IDs. They are **not** the values sent to Artemis. Artemis
receives the human season and episode numbers, for example `seasonId=1` and
`episodeId=1`.

Local API test endpoints:

```text
GET /v2/stream-movie?tmdbId=884605&provider=artemis
GET /v2/stream-tv?tmdbId=2316&season=1&episode=1&provider=artemis
GET /v2/providers
```

For example:

```bash
curl 'http://localhost:3000/v2/stream-movie?tmdbId=884605&provider=artemis'
curl 'http://localhost:3000/v2/stream-tv?tmdbId=2316&season=1&episode=1&provider=artemis'
```

Artemis returned a correctly encrypted but empty `variants` array for both
examples at the end of the 2026-07-24 verification. The same empty result was
observed in ZStream's own browser player, so this was an upstream
availability/mirroring result rather than a difference in our implementation.
An empty list should be treated as “not available from Artemis right now,” not
as a decryption error.

## End-to-end request sequence

For a movie:

```text
tmdbId
  -> make 90-second time-window proofs
  -> GET artemis.fontaine.lol/lookup
  -> decrypt response.d with AES-256-GCM
  -> map payload.variants to ProviderLink[]
  -> proxy and validate the selected media URL
```

For an episode, `seasonId` and `episodeId` are added to the signed query and to
the first HMAC input.

## Lookup request

### URL

```text
GET https://artemis.fontaine.lol/lookup
```

Movie query fields:

```text
_pk=<AES-GCM proof encoded as lowercase hex>
tmdbId=<TMDB ID>
z=<10 lowercase hex characters>
```

TV query fields:

```text
_pk=<AES-GCM proof encoded as lowercase hex>
episodeId=<episode number>
seasonId=<season number>
tmdbId=<TMDB ID>
z=<10 lowercase hex characters>
```

All fields are sorted by key with `URLSearchParams.sort()` before the query is
serialized. This is important because `X-AR-Sig` signs the exact serialized
query string.

ZStream can optionally append:

```text
pw=<Cloudflare Turnstile token>
```

The `pw` field is added **after** the signed base query in the current bundle;
it is not covered by `X-AR-Sig`. The repository provider does not attempt to
solve or bypass Turnstile. At the time of inspection, the lookup endpoint
accepted the signed request without `pw`.

### Required custom headers

```text
X-PS-Sig: <64 lowercase hex characters>
X-AR-Sig: <64 lowercase hex characters>
```

ZStream also sends a normal browser `User-Agent` and a ZStream `Referer`.
Browser requests perform a CORS preflight because of the two custom headers.

### Real captured movie request shape

Values below are expired and included only to show lengths/order:

```text
GET /lookup?_pk=<192 hex chars>&tmdbId=884605&z=<10 hex chars>
X-PS-Sig: <64 hex chars>
X-AR-Sig: <64 hex chars>
Referer: https://zstream.mov/media/tmdb-movie-884605-no-hard-feelings
```

The API returned:

```json
{
  "d": "<AES-GCM envelope encoded as lowercase hex>"
}
```

## Cryptographic construction

Node names below match constants in `artemis.ts`.

### Time window

```text
unixSeconds = floor(Date.now() / 1000)
window = floor(unixSeconds / 90)
```

Because the signatures expire on a 90-second boundary:

- generate all proof fields immediately before the request;
- do not cache a complete signed lookup URL;
- check server clock synchronization when valid-looking requests fail;
- if needed during a boundary race, retry once using a newly generated request.

### `X-PS-Sig`

Algorithm: HMAC-SHA-256, lowercase hexadecimal output.

Movie input:

```text
<tmdbId>|||<window>
```

Episode input:

```text
<tmdbId>|<season>|<episode>|<window>
```

Key, hexadecimal:

```text
287a70ec1a95bd245c294103ba586301d0da41c1dd03057c2fe14ae34ac85782
```

### `_pk`

1. Generate a random 12-byte AES-GCM IV.
2. Generate 16 random bytes and encode them as 32 lowercase hex characters.
3. Build compact JSON, with no whitespace:

```json
{"t":"<tmdbId>","x":<unixSeconds>,"n":"<32 hex chars>"}
```

4. Encrypt its UTF-8 bytes with AES-256-GCM.
5. Concatenate:

```text
12-byte IV || ciphertext || 16-byte authentication tag
```

6. Encode the entire envelope as lowercase hexadecimal.

Key, hexadecimal:

```text
60ee98763acda96a682d3cccc180dabecc1193cfce9556cdf9e0246da916e775
```

For a six-digit TMDB ID the result observed in production was 192 hex
characters. Its exact length can vary if the JSON's ID or timestamp length
changes.

### `z`

Algorithm: HMAC-SHA-256.

Input:

```text
<tmdbId>:<window>
```

Key, hexadecimal:

```text
a7213741d9be938b1dfc358e802a615bdeddb7a13b6aa3ee840e9014e6e4db05
```

Take the first ten characters of the lowercase hex digest.

### `X-AR-Sig`

First create and sort all normal query fields (`_pk`, episode/season fields
when applicable, `tmdbId`, and `z`). Serialize them exactly as
`URLSearchParams` does.

Algorithm: HMAC-SHA-256 over that exact query string.

Key, hexadecimal:

```text
f8dccaefd1952960af896e01cda3c7d6f2076eea38dcf4e162a2480b6b02cdc6
```

Do not regenerate `_pk`, change ordering, or URL-encode the query differently
after calculating this signature.

## Response decryption

The lookup JSON's `d` property is lowercase hex representing:

```text
12-byte IV || ciphertext || 16-byte AES-GCM authentication tag
```

Decrypt with AES-256-GCM and this key:

```text
b9f74f0d4cb6e19e4101a132f3b09a468d680119bb4bf7b4781d3b9aad09f59b
```

Then UTF-8 decode and JSON parse the plaintext.

A confirmed empty response decrypts to:

```json
{
  "tmdb_id": "",
  "quality": "",
  "quality_t": 0,
  "variants": []
}
```

The non-empty schema reconstructed from the production mapper is:

```json
{
  "tmdb_id": "884605",
  "quality": "source-level quality label",
  "quality_t": 0,
  "variants": [
    {
      "fid": "opaque variant identifier",
      "name": "display name",
      "quality": "2160p",
      "codec": "codec label",
      "tag": "variant tag",
      "type": "hls or mp4",
      "url": "absolute or Artemis-relative media URL"
    }
  ]
}
```

The ZStream mapper also creates `size` and `size_bytes` fields locally, both
empty/zero; those are not needed by this API.

Relative `url` values are resolved against:

```text
https://artemis.fontaine.lol/
```

ZStream selects the first variant whose URL responds as a usable HLS playlist,
falling back to the first returned variant. This repository exposes all
variants and lets its shared stream validation remove unusable ones.

## Media/CDN observations

During an earlier successful lookup, the player checked a URL shaped like:

```text
GET https://cdn.fontaine.lol/<tmdbId>?_fp=<opaque proof>&w=<10 hex chars>
X-FN-Sig: <64 hex chars>
X-FN-Key: <64 hex chars>
```

For TMDB `884605`, that check returned:

```json
{ "error": "not mirrored yet", "tmdb_id": "884605" }
```

This CDN request was observed while the player was checking returned
variants. Its signing material was not needed to create the Artemis lookup,
and the current Artemis variant mapper exposes only a final `url`, not a
separate CDN-header object. If future returned URLs require `X-FN-*` headers
and no longer contain a usable signed URL, this is the next protocol layer to
trace.

The public ZStream source contains HLS retry behavior for `403` responses and
special handling for a missing file identifier. This reinforces the need to
keep Artemis URLs proxied and to expect short-lived or not-yet-mirrored files.

## Mapping to this repository

Each valid variant becomes:

```ts
{
  server: `Artemis - ${name/tag/codec}`,
  url: absoluteVariantUrl,
  isM3U8: type !== 'mp4',
  quality: String(quality),
  subtitles: [],
  headers: {
    Accept: '*/*',
    Origin: 'https://zstream.mov',
    Referer: 'https://zstream.mov/',
    'User-Agent': '<browser UA>'
  },
  requiresProxy: true
}
```

Do not remove `requiresProxy`. Browser consumers cannot reliably set `Origin`,
`Referer`, or `User-Agent`, and direct upstream URLs may expire.

## How to repair after a bundle change

### 1. Confirm the failure category

- HTTP `401`/`403`, or an encrypted empty response for media that plays on
  ZStream: likely signatures, clock, Turnstile, or fingerprint enforcement.
- AES authentication failure: response key or envelope format changed.
- JSON parses but fields are missing: response schema changed.
- Variants are returned but shared validation removes them: playback/CDN
  requirements changed.
- Both this provider and ZStream show no variants: upstream availability, not
  necessarily a scraper bug.

### 2. Download the current production assets

Open the ZStream HTML and identify the hashed JavaScript files:

```bash
curl -L 'https://zstream.mov/media/tmdb-movie-884605-no-hard-feelings'
```

At the 2026-07-24 inspection they included:

```text
/assets/index-Cow7o-Ia.js
/assets/vendor-d6VD-z4o.js
```

The hashes will change. Never assume those filenames remain valid.

### 3. Capture the browser request

In browser developer tools:

1. Open Network.
2. Filter for `artemis.fontaine.lol`.
3. Start the Artemis source.
4. Record the complete `/lookup` URL, request headers, response body, and
   initiator.
5. Compare field names, ordering, signature lengths, and the presence of `pw`.
6. Inspect the next media/CDN request as well.

Use an isolated browser profile because streaming sites commonly load
third-party advertising. Do not copy session cookies or Turnstile tokens into
source control.

### 4. Locate the Artemis provider in the bundle

Useful anchors, even when most strings are obfuscated:

- the visible source label `Artemis [4K]`;
- `/lookup`;
- `variants`;
- `tmdbId`, `seasonId`, and `episodeId`;
- WebCrypto calls to `importKey`, `sign`, `encrypt`, and `decrypt`;
- 12-byte `Uint8Array` IV allocation;
- HMAC-SHA-256 and AES-GCM algorithm objects;
- a ten-character substring of an HMAC hex digest.

In the inspected vendor bundle the relevant minified functions were:

```text
Eh  Artemis scrape flow
_M  _pk, z, and X-PS-Sig generation
ZM  X-AR-Sig generation
JM  lookup response decryption
QM  relative-to-absolute Artemis URL conversion
Tv  Artemis API base URL decoder
```

Minified names are not stable. Follow behavior, not symbol names.

### 5. Recover rotated byte arrays

The keys were not stored as plain hex. Each helper rebuilt a 32-byte
`Uint8Array` by XORing other literal arrays. Safely evaluate only the literal
array expressions and small key-reconstruction helpers; do not execute an
unknown full site bundle in your server environment.

After recovery, print each key as hex and update:

- `PROOF_SIGNATURE_KEY`
- `PROOF_ENCRYPTION_KEY`
- `SHORT_SIGNATURE_KEY`
- `LOOKUP_SIGNATURE_KEY`
- `RESPONSE_ENCRYPTION_KEY`

Then update this document's date and constants.

### 6. Verify cryptography independently

For one browser-captured request:

1. Decrypt `_pk` with the candidate proof key.
2. Confirm its JSON contains the expected TMDB ID and a current Unix time.
3. Derive `window = floor(x / 90)`.
4. Recalculate `X-PS-Sig`.
5. Recalculate `z`.
6. Recalculate `X-AR-Sig` over the exact captured sorted query.
7. Confirm every value exactly matches the browser.
8. Decrypt the captured response `d`.

This comparison was completed successfully on 2026-07-24: all three request
signatures matched the live browser byte-for-byte and the response decrypted
successfully.

### 7. Test both media paths

Always test:

```text
/v2/stream-movie?tmdbId=884605&provider=artemis
/v2/stream-tv?tmdbId=2316&season=1&episode=1&provider=artemis
```

Also choose one title currently confirmed to play on ZStream. A single title
can legitimately be absent or “not mirrored yet.”

Check:

- non-empty variants when ZStream itself has them;
- correct season/episode numbering;
- quality labels are preserved;
- HLS and MP4 classification;
- proxy URLs validate and play;
- master and child HLS playlists are rewritten through the proxy;
- segment/key requests retain required headers.

## Known limitations

- No automated Turnstile solving is included or intended.
- No Artemis VIP key is used. ZStream's preferences mention optional
  `avip_...` keys, but the free Artemis lookup flow inspected here did not add
  one to this request.
- Audio language and subtitles are not declared by the observed variant
  schema.
- The keys and domains are volatile public bundle constants.
- A valid encrypted response can contain zero variants.
- CDN signing may become a separate required repair layer.

## Quick checklist

- [ ] ZStream itself returns Artemis variants for the chosen title.
- [ ] Server clock is correct.
- [ ] Query keys are sorted before `X-AR-Sig`.
- [ ] The signature window is 90 seconds.
- [ ] `_pk` is `IV || ciphertext || tag`, all hex.
- [ ] Request HMACs match a captured browser request.
- [ ] `d` decrypts as `IV || ciphertext || tag`.
- [ ] Movie and episode lookup fields are correct.
- [ ] Relative stream URLs use the current Artemis base.
- [ ] Playback remains proxied.
- [ ] CDN/HLS requests retain the required headers.
