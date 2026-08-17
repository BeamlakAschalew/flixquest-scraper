import assert from 'node:assert/strict'
import test from 'node:test'
import { cinevaroProvider } from './cinevaro.js'

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=600000,RESOLUTION=640x266
360/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x356
480/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x534
720/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4800000,RESOLUTION=1920x800
1080/index.m3u8
`

test('Cinevaro resolves direct HLS variants and normalizes cinema dimensions', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: URL; init?: RequestInit }> = []

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    calls.push({ url, init })
    if (url.hostname === 'resolver2.cinevaro.app') {
      return Response.json({
        ok: true,
        streams: [
          {
            url: 'https://cinevaro-media.example/hls/master.m3u8?token=short',
            label: 'Vaplayer - Earth 1',
            quality: 'Auto 1',
          },
        ],
      })
    }
    if (url.hostname === 'cinevaro-media.example') {
      return new Response(MASTER)
    }
    return new Response('Not found', { status: 404 })
  }) as typeof fetch

  try {
    const links = await cinevaroProvider.streamMovie('550')
    assert.deepEqual(
      links.map(link => link.quality),
      ['360p', '480p', '720p', '1080p']
    )
    assert.equal(
      links[3].url,
      'https://cinevaro-media.example/hls/1080/index.m3u8'
    )
    assert.equal(
      links.every(link => link.isM3U8),
      true
    )
    assert.equal(calls[0].url.searchParams.get('source'), 'vaplayer')
    assert.equal(new Headers(calls[0].init?.headers).get('X-API-Key'), '123123')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Cinevaro sends TV coordinates and rejects invalid requests', async () => {
  const originalFetch = globalThis.fetch
  const resolverUrls: URL[] = []

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.hostname === 'resolver2.cinevaro.app') {
      resolverUrls.push(url)
      return Response.json({ ok: true, streams: [] })
    }
    return new Response('Not found', { status: 404 })
  }) as typeof fetch

  try {
    assert.deepEqual(await cinevaroProvider.streamTV('1396', 0, 1), [])
    assert.equal(resolverUrls.length, 0)
    assert.deepEqual(await cinevaroProvider.streamTV('1396', 1, 1), [])
    assert.equal(resolverUrls[0]?.searchParams.get('season'), '1')
    assert.equal(resolverUrls[0]?.searchParams.get('episode'), '1')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Cinevaro keeps the direct master when variant inspection fails', async () => {
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.hostname === 'resolver2.cinevaro.app') {
      return Response.json({
        ok: true,
        streams: [
          {
            url: 'https://cinevaro-media.example/hls/master.m3u8',
            quality: 'auto',
          },
        ],
      })
    }
    throw new Error('manifest unavailable')
  }) as typeof fetch

  try {
    const links = await cinevaroProvider.streamMovie('550')
    assert.equal(links.length, 1)
    assert.equal(links[0].url, 'https://cinevaro-media.example/hls/master.m3u8')
    assert.equal(links[0].quality, 'auto')
  } finally {
    globalThis.fetch = originalFetch
  }
})
