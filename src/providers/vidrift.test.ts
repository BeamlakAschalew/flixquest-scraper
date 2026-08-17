import assert from 'node:assert/strict'
import test from 'node:test'
import { vidRiftProvider } from './vidrift.js'

test('VidRift keeps distinct media roots and exposes standard HLS qualities', async () => {
  const originalFetch = globalThis.fetch
  const tokenBodies: Record<string, unknown>[] = []
  let sourceUrl: URL | undefined

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.pathname === '/api/playback-token') {
      tokenBodies.push(
        JSON.parse(String(init?.body)) as Record<string, unknown>
      )
      return Response.json({ token: 'signed-playback-token' })
    }
    if (url.pathname.startsWith('/api/source/movie/')) {
      sourceUrl = url
      return Response.json({
        streams: [
          {
            proxyUrl:
              '/api/proxy/hls?url=https%3A%2F%2Fearth-a.example%2Ffirst%2Fmaster.m3u8&token=signed',
          },
          {
            proxyUrl:
              '/api/proxy/hls?url=https%3A%2F%2Fearth-a.example%2Fduplicate%2Fmaster.m3u8&token=signed',
          },
          { url: 'https://earth-b.example/master.m3u8' },
        ],
      })
    }
    if (url.hostname === 'earth-a.example') {
      if (url.pathname.startsWith('/first/')) {
        return new Response('Unavailable', { status: 503 })
      }
      return new Response(
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=700000,RESOLUTION=640x266\n360.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x534\n720.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=4400000,RESOLUTION=1920x800\n1080.m3u8\n'
      )
    }
    if (url.hostname === 'earth-b.example') {
      return new Response(
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480\n480.m3u8\n'
      )
    }
    return new Response('Not found', { status: 404 })
  }) as typeof fetch

  try {
    const links = await vidRiftProvider.streamMovie('27205')
    assert.deepEqual(tokenBodies, [
      { tmdbId: 27205, type: 'movie', season: 0, episode: 0 },
    ])
    assert.equal(sourceUrl?.searchParams.get('provider'), 'vaplayer')
    assert.equal(sourceUrl?.searchParams.get('token'), 'signed-playback-token')
    assert.deepEqual(
      links.map(link => link.quality),
      ['360p', '720p', '1080p', '480p']
    )
    assert.equal(new Set(links.map(link => new URL(link.url).origin)).size, 2)
    assert.equal(
      links[2].hlsVariant,
      'https://earth-a.example/duplicate/1080.m3u8'
    )
    assert.equal(links[0].requiresProxy, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('VidRift sends TV coordinates and rejects invalid episodes', async () => {
  const originalFetch = globalThis.fetch
  let tokenBody: Record<string, unknown> | undefined

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.pathname === '/api/playback-token') {
      tokenBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return Response.json({ token: 'tv-token' })
    }
    if (url.pathname === '/api/source/tv/1396/1/1') {
      return Response.json({ streams: [] })
    }
    return new Response('Not found', { status: 404 })
  }) as typeof fetch

  try {
    assert.deepEqual(await vidRiftProvider.streamTV('1396', 1, 0), [])
    assert.deepEqual(await vidRiftProvider.streamTV('1396', 1, 1), [])
    assert.deepEqual(tokenBody, {
      tmdbId: 1396,
      type: 'tv',
      season: 1,
      episode: 1,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
