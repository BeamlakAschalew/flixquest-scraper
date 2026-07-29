# FlixQuest Cloudflare media proxy

A separate Cloudflare Worker for authenticated API forwarding and
session-consistent HLS proxying. Each session is pinned to one Durable Object,
so API discovery, redirects, cookies, manifests, renditions, encryption keys,
and media segments all leave through the same Cloudflare location.

The Worker is not an open proxy:

- Session creation, API fetches, and resource registration require a service
  token.
- Public media URLs are short-lived and HMAC-signed.
- Every initial URL, redirect, and playlist URI must match `ALLOWED_HOSTS`.
- Private/link-local destinations, credentials in URLs, non-HTTP protocols,
  hop-by-hop headers, oversized control bodies, and oversized playlists are
  rejected.
- Upstream redirects are followed manually so credentials cannot leak to a
  different origin.
- A per-session cookie jar is retained inside the Durable Object.

## Important egress guarantee

A Durable Object stays in one Cloudflare location after creation. This removes
the common failure where discovery runs near the API server and HLS requests
later run near the player. It does **not** contractually guarantee that every
`fetch()` uses one exact public source IP from Cloudflare's shared egress pool.

If the upstream compares the exact source IP and Cloudflare changes shared
egress addresses within a location, you need a Cloudflare dedicated-egress
configuration that your account team confirms covers these Worker subrequests,
or another fixed-egress service. Durable Objects alone provide location and
session affinity, not a dedicated IP.

## Deploy

Requires Node.js 22+ and a Cloudflare account.

```sh
cd cloudflare-media-proxy
npm install
npx wrangler login
npx wrangler secret put SERVICE_TOKEN
npx wrangler secret put SIGNING_SECRET
npm run deploy
```

Use two different random values of at least 32 bytes. For example, generate
each locally with `openssl rand -base64 48`.

This project uses Wrangler's declarative Durable Object `exports`
configuration. Do not replace it with a `migrations` block after the first
deployment.

Set a custom domain or keep the generated `workers.dev` URL. If you use a
custom hostname, add this non-secret variable to `wrangler.jsonc`:

```json
"PUBLIC_BASE_URL": "https://media-proxy.example.com"
```

Configure the Express app with:

```dotenv
CLOUDFLARE_MEDIA_PROXY_URL=https://media-proxy.example.com
CLOUDFLARE_MEDIA_PROXY_TOKEN=<same value as Worker SERVICE_TOKEN>
# Optional; the first request chooses placement when omitted.
CLOUDFLARE_MEDIA_PROXY_LOCATION_HINT=weur
```

When configured, `src/providers/vixsrc.ts` creates one session and sends the
entire Vixsrc chain through it. Returned playback and subtitle URLs already
point at the Worker, so the Express `/proxy` route does not wrap them again.
Other providers' M3U8 links are also registered with the Worker automatically.
Add their API/CDN hosts to `ALLOWED_HOSTS`; if session creation or registration
fails, those non-Vixsrc links fall back to the existing Express proxy. DASH
links continue to use the Express proxy.

## Allowlist

`ALLOWED_HOSTS` is a comma-separated exact/wildcard hostname list:

```json
"ALLOWED_HOSTS": "vixsrc.to,*.vixsrc.to,vix-content.net,*.vix-content.net,api.example.com,cdn.example.com"
```

Wildcards match subdomains only: `*.example.com` does not match
`example.com`. Keep this list narrow. Never use a catch-all value.

## API

All control endpoints require:

```http
Authorization: Bearer <SERVICE_TOKEN>
```

Create a session:

```http
POST /v1/sessions
Content-Type: application/json

{"locationHint":"weur"}
```

Forward an API request through that session:

```http
POST /v1/sessions/{sessionId}/fetch
Content-Type: application/json

{
  "url": "https://api.example.com/items",
  "method": "POST",
  "headers": {"Content-Type": "application/json"},
  "body": "{\"page\":1}",
  "bodyEncoding": "utf8"
}
```

The upstream status/body are returned directly. The final URL after redirects
is available in `X-Media-Proxy-Upstream-URL`. Set `bodyEncoding` to `base64`
for binary request bodies.

Register an HLS root:

```http
POST /v1/sessions/{sessionId}/resources
Content-Type: application/json

{
  "url": "https://cdn.example.com/master.m3u8?token=...",
  "headers": {"Referer": "https://example.com/embed/123"},
  "kind": "hls",
  "selectedVariant": "https://cdn.example.com/1080/index.m3u8",
  "preferredAudioLanguage": "eng"
}
```

The returned `url` is public until the resource/session expiry. Every plain
playlist URI and every `URI="..."` attribute is rewritten recursively.
Byte-range requests and common media response headers are preserved.

`GET /health` is unauthenticated and performs no upstream request.

## Operational notes

- Set Cloudflare rate limits/WAF rules on the public `/media/` route.
- Keep `CORS_ORIGIN` at a specific player origin when possible; `*` is the
  compatibility default.
- Playlists and tokenized media use `private, no-store`. This prioritizes
  correctness and prevents Cloudflare cache hits from bypassing session egress.
- Session expiry defaults to six hours and is capped at 24 hours. Durable
  Object storage is deleted by an alarm when the session expires.
- Upstream response headers must arrive within `UPSTREAM_TIMEOUT_MS` (45
  seconds by default). Once headers arrive, media bodies continue streaming.
- Cloudflare Workers stream response bodies and do not impose a response-body
  size limit, but account request limits, CPU limits, and billing still apply.

## Local checks

Copy `.dev.vars.example` to `.dev.vars`, replace both secrets, then run:

```sh
npm test
npm run typecheck
npm run dev
```
