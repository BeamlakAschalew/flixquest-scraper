import assert from 'node:assert/strict'
import test from 'node:test'
import { bingrProvider } from './bingr.js'

test('Bingr keeps partial multi-server results and playback metadata', async () => {
  const originalFetch = globalThis.fetch
  const streamBodies: Array<Record<string, unknown>> = []

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.pathname === '/api/details/movie/27205') {
      return Response.json({ title: 'Inception', year: 2010 })
    }
    if (url.pathname === '/api/stream') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      streamBodies.push(body)
      if (body.srv === 's11') {
        return Response.json({
          sources: [
            {
              url: 'https://media.example/hindi-1080.m3u8',
              quality: '1080p',
              language: 'Hindi/Multi',
              type: 'hls',
              headers: { Referer: 'https://hdghartv.cc/' },
            },
          ],
          subtitles: [{ url: 'https://subs.example/en.vtt', label: 'English' }],
        })
      }
      if (body.srv === 's12') {
        return Response.json({
          sources: [
            {
              url: 'https://media.example/original-720.mp4',
              quality: 720,
              language: 'Original',
              type: 'mp4',
            },
          ],
        })
      }
      return new Response(JSON.stringify({ error: 'missing' }), { status: 404 })
    }
    return new Response('Not found', { status: 404 })
  }) as typeof fetch

  try {
    const links = await bingrProvider.streamMovie('27205')
    assert.equal(streamBodies.length, 9)
    assert.deepEqual(streamBodies[0], {
      srv: 's11',
      t: 'movie',
      id: '27205',
      query: { title: 'Inception', year: '2010' },
    })
    assert.equal(links.length, 2)
    assert.equal(links[0].quality, '1080p')
    assert.equal(links[0].requiresProxy, true)
    assert.equal(links[0].headers?.Referer, 'https://hdghartv.cc/')
    assert.equal(links[0].subtitles[0].label, 'English')
    assert.equal(links[1].quality, '720p')
    assert.equal(links[1].isM3U8, false)
    assert.equal(links[1].requiresProxy, false)
    assert.deepEqual(await bingrProvider.streamTV('1396', 1, 0), [])
  } finally {
    globalThis.fetch = originalFetch
  }
})
