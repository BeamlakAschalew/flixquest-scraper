import assert from 'node:assert/strict'
import { createDecipheriv, createHash } from 'node:crypto'
import test from 'node:test'
import { goatedProvider } from './goated.js'

const SECRET =
  '79eb073a697f8e22d44fdb60971efa9b1cd224fa7963f9095e48971f5e13866b'

function decryptRequest(body: string): Record<string, unknown> {
  const envelope = JSON.parse(body) as {
    q: string
    s: string
    t: string
    d: string
  }
  const key = createHash('sha256').update(`${SECRET}:${envelope.d}`).digest()
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(envelope.s, 'base64')
  )
  decipher.setAuthTag(Buffer.from(envelope.t, 'base64'))
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(envelope.q, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  ) as Record<string, unknown>
}

test('GOATED solves, encrypts, and returns adaptive HLS sources', async () => {
  const originalFetch = globalThis.fetch
  const resolveRequests: Record<string, unknown>[] = []

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.pathname === '/api/challenge') {
      return Response.json({ challenge: 'test-challenge', difficulty: 0 })
    }
    if (url.pathname === '/api/resolve') {
      const request = decryptRequest(String(init?.body))
      resolveRequests.push(request)
      const source = String(request.source || 'Orbit')
      return Response.json({
        url: `https://cdn.example/${source.toLowerCase()}/master.m3u8?token=short`,
        source,
        format: 'hls',
        availableSources: ['Orbit', 'Valenox'],
        subtitles:
          source === 'Orbit'
            ? [{ url: 'https://subs.example/en.vtt', label: 'English' }]
            : [{ url: 'https://subs.example/es.vtt', language: 'Spanish' }],
      })
    }
    if (url.hostname === 'cdn.example') {
      return new Response(
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\n360.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080\n1080.m3u8\n'
      )
    }
    return new Response('Not found', { status: 404 })
  }) as typeof fetch

  try {
    const links = await goatedProvider.streamMovie('27205')
    assert.equal(resolveRequests.length, 2)
    assert.deepEqual(resolveRequests[0], {
      mediaType: 'movie',
      id: '27205',
      challenge: 'test-challenge',
      nonce: '0',
    })
    assert.equal(resolveRequests[1].source, 'Valenox')
    assert.equal(links.length, 2)
    assert.equal(links[0].quality, 'auto')
    assert.equal(links[0].server, 'GOATED | Orbit')
    assert.equal(links[0].isM3U8, true)
    assert.equal(links[0].subtitles.length, 2)
    assert.deepEqual(await goatedProvider.streamTV('27205', 0, 1), [])
  } finally {
    globalThis.fetch = originalFetch
  }
})
