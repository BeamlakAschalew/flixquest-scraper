import assert from 'node:assert/strict'
import test from 'node:test'
import { riveProvider } from './rive.js'

test('Rive keeps partial resolver results and normalizes quality metadata', async () => {
  const originalFetch = globalThis.fetch
  const resolverQueries: URL[] = []

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.pathname === '/api/providers') {
      return Response.json({ data: ['citadel', 'flowcast', 'broken'] })
    }
    if (url.pathname === '/api/provider') {
      resolverQueries.push(url)
      if (url.searchParams.get('provider') === 'citadel') {
        return Response.json({
          data: {
            sources: [
              {
                quality: '1080p (OST)',
                url: 'https://media.example/citadel.m3u8?token=signed',
                source: 'Citadel',
                format: 'hls',
              },
            ],
            captions: [
              { file: 'https://subs.example/en.srt', label: 'English' },
            ],
          },
        })
      }
      if (url.searchParams.get('provider') === 'flowcast') {
        return Response.json({
          data: {
            sources: [
              {
                quality: 720,
                url: 'https://media.example/720.mp4',
                source: 'FlowCast',
                format: 'mp4',
              },
              {
                quality: 480,
                url: 'https://media.example/480.mp4',
                source: 'FlowCast',
                format: 'mp4',
              },
            ],
          },
        })
      }
      return new Response(JSON.stringify({ error: 'resolver failed' }), {
        status: 500,
      })
    }
    return new Response('Not found', { status: 404 })
  }) as typeof fetch

  try {
    const links = await riveProvider.streamMovie('27205')
    assert.equal(resolverQueries.length, 3)
    assert.deepEqual(
      links.map(link => link.quality),
      ['1080p', '720p', '480p']
    )
    assert.equal(links[0].isM3U8, true)
    assert.match(links[0].server, /1080p \(OST\)/)
    assert.equal(links[1].isM3U8, false)
    assert.equal(links[0].requiresProxy, true)
    assert.equal(links[0].headers?.Origin, 'https://rivestream.app')
    assert.equal(links[0].subtitles[0].label, 'English')
    assert.equal(links[1].subtitles[0].label, 'English')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Rive sends TV coordinates and rejects invalid episodes', async () => {
  const originalFetch = globalThis.fetch
  let providerUrl: URL | undefined

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.pathname === '/api/providers') {
      return Response.json({ data: ['primevids'] })
    }
    providerUrl = url
    return Response.json({
      data: {
        sources: [
          {
            quality: 'ipcloud',
            url: 'https://media.example/master.m3u8',
            format: 'hls',
          },
        ],
      },
    })
  }) as typeof fetch

  try {
    assert.deepEqual(await riveProvider.streamTV('1396', 1, 0), [])
    const links = await riveProvider.streamTV('1396', 1, 1)
    assert.equal(providerUrl?.searchParams.get('id'), '1396')
    assert.equal(providerUrl?.searchParams.get('season'), '1')
    assert.equal(providerUrl?.searchParams.get('episode'), '1')
    assert.equal(links[0].quality, 'auto')
  } finally {
    globalThis.fetch = originalFetch
  }
})
