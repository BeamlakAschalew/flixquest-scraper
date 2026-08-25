import assert from 'node:assert/strict'
import test from 'node:test'
import { vidRockProvider } from './vidrock.js'

test('VidRock processes only the Orion server from the returned server map', async () => {
  const originalFetch = globalThis.fetch
  const calls: URL[] = []

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    calls.push(url)

    if (url.pathname === '/api/movie/550') {
      return Response.json({
        Luna: {
          url: encodeURIComponent('https://luna.example/master.m3u8'),
          type: 'hls',
          language: 'English',
        },
        orion: {
          url: encodeURIComponent('https://orion.example/master.m3u8'),
          type: 'hls',
          language: 'English',
        },
        Astra: {
          url: encodeURIComponent('https://astra.example/video.mp4'),
          type: 'mp4',
          language: 'English',
        },
      })
    }

    if (url.pathname === '/v2/movie/550') return Response.json([])
    return new Response('Not found', { status: 404 })
  }) as typeof fetch

  try {
    const links = await vidRockProvider.streamMovie('550')

    assert.equal(links.length, 1)
    assert.equal(links[0].server, 'vidrock-orion')
    assert.equal(links[0].url, 'https://orion.example/master.m3u8')
    assert.equal(links[0].isM3U8, true)
    assert.equal(calls.length, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('VidRock returns no links when Orion is unavailable', async () => {
  const originalFetch = globalThis.fetch
  let subtitleRequested = false

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.pathname === '/api/movie/550') {
      return Response.json({
        Luna: {
          url: encodeURIComponent('https://luna.example/master.m3u8'),
          type: 'hls',
        },
      })
    }
    subtitleRequested = true
    return Response.json([])
  }) as typeof fetch

  try {
    assert.deepEqual(await vidRockProvider.streamMovie('550'), [])
    assert.equal(subtitleRequested, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})
