import assert from 'node:assert/strict'
import test from 'node:test'
import { bingrProvider } from './bingr.js'

test('Bingr tries servers until one works and keeps partial full-mode results', async () => {
  const originalFetch = globalThis.fetch
  const streamBodies: Array<Record<string, unknown>> = []
  let siriusWorks = false

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.pathname === '/api/details/movie/27205') {
      return Response.json({ title: 'Inception', year: 2010 })
    }
    if (url.pathname === '/api/stream') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      streamBodies.push(body)
      if (body.srv === 's11') {
        if (!siriusWorks) return Response.json({ sources: [] })
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
    const defaultLinks = await bingrProvider.streamMovie('27205')
    assert.equal(streamBodies.length, 3)
    assert.equal(streamBodies[0].srv, 's11')
    assert.equal(streamBodies[1].srv, 's40')
    assert.equal(streamBodies[2].srv, 's12')
    assert.equal(defaultLinks.length, 1)

    siriusWorks = true
    streamBodies.length = 0
    const links = await bingrProvider.streamMovie('27205', { full: true })
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
