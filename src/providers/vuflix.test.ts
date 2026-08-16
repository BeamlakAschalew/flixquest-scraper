import assert from 'node:assert/strict'
import test from 'node:test'
import { vuflixProvider } from './vuflix.js'

test('Vuflix returns 4K before querying 4K2 or slower providers', async () => {
  const originalFetch = globalThis.fetch
  const queriedProviders: string[] = []

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.pathname === '/api/player/providers') {
      return Response.json({
        providers: [
          { id: 'vsembed', name: 'Sigma' },
          { id: 'cineplay', name: '4K' },
          { id: 'cinejoy', name: '4K2' },
          { id: 'vaplayer', name: 'Alpha' },
        ],
      })
    }

    const provider = url.searchParams.get('provider') || ''
    queriedProviders.push(provider)
    if (provider === 'cineplay') {
      return Response.json({
        ok: true,
        sources: [
          {
            provider,
            providerName: '4K',
            type: 'hls',
            quality: '1080p',
            url: 'https://media.example/4k/1080.m3u8',
            qualities: [
              {
                quality: '2160p',
                url: 'https://media.example/4k/2160.m3u8',
              },
              {
                quality: '1080p',
                url: 'https://media.example/4k/1080.m3u8',
              },
              {
                quality: '720p',
                url: 'https://media.example/4k/720.m3u8',
              },
              {
                quality: '480p',
                url: 'https://media.example/4k/480.m3u8',
              },
            ],
          },
        ],
      })
    }
    throw new Error(`Slow provider ${provider} should not be queried`)
  }) as typeof fetch

  try {
    const links = await vuflixProvider.streamMovie('533535')
    assert.deepEqual(queriedProviders, ['cineplay'])
    assert.deepEqual(
      links
        .filter(link => link.server.includes('4K (cineplay)'))
        .map(link => link.quality),
      ['2160p', '1080p', '720p', '480p']
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Vuflix tries 4K2 when 4K is empty before slower providers', async () => {
  const originalFetch = globalThis.fetch
  const queriedProviders: string[] = []

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.pathname === '/api/player/providers') {
      return Response.json({
        providers: [
          { id: 'vsembed', name: 'Sigma' },
          { id: 'cineplay', name: '4K' },
          { id: 'cinejoy', name: '4K2' },
        ],
      })
    }

    const provider = url.searchParams.get('provider') || ''
    queriedProviders.push(provider)
    if (provider === 'cineplay') {
      return Response.json({ ok: false, sources: [] })
    }
    if (provider === 'cinejoy') {
      return Response.json({
        ok: true,
        sources: [
          {
            provider,
            providerName: '4K2',
            type: 'hls',
            quality: '2160p',
            url: 'https://media.example/4k2/2160.m3u8',
          },
        ],
      })
    }
    throw new Error(`Slow provider ${provider} should not be queried`)
  }) as typeof fetch

  try {
    const links = await vuflixProvider.streamMovie('533535')
    assert.deepEqual(queriedProviders, ['cineplay', 'cinejoy'])
    assert.equal(links.length, 1)
    assert.equal(links[0].quality, '2160p')
    assert.match(links[0].server, /4K2 \(cinejoy\)/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Vuflix queries the remaining catalog when both 4K providers are empty', async () => {
  const originalFetch = globalThis.fetch
  const queriedProviders: string[] = []

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.pathname === '/api/player/providers') {
      return Response.json({
        ok: true,
        providers: [
          { id: 'vsembed', name: 'Sigma' },
          { id: 'cineplay', name: '4K' },
          { id: 'cinejoy', name: '4K2' },
          { id: 'vaplayer', name: 'Alpha' },
          { id: 'moviebox', name: 'Pi' },
          { id: 'huhu', name: 'Beta', autoLoad: false },
          { id: 'broken', name: 'Broken', autoLoad: false },
        ],
      })
    }

    const provider = url.searchParams.get('provider') || ''
    queriedProviders.push(provider)
    if (provider === 'vsembed') {
      return Response.json({
        ok: true,
        sources: [
          {
            provider,
            providerName: 'Sigma',
            label: 'Sigma - English',
            type: 'hls',
            quality: '1080p',
            language: 'en',
            url: 'https://media.example/sigma/master.m3u8',
          },
        ],
        subtitles: [{ src: 'https://subs.example/en.vtt', label: 'English' }],
      })
    }
    if (provider === 'cineplay' || provider === 'cinejoy') {
      return Response.json({ ok: false, sources: [] })
    }
    if (provider === 'vaplayer') {
      return Response.json({
        ok: true,
        sources: [
          {
            provider,
            providerName: 'Alpha',
            type: 'hls',
            quality: 'Auto',
            url: 'https://media.example/alpha/one.m3u8',
            candidates: [
              {
                quality: '1080p',
                url: 'https://media.example/alpha/one.m3u8',
              },
              {
                quality: '720p',
                url: 'https://media.example/alpha/two.m3u8',
              },
            ],
          },
        ],
      })
    }
    if (provider === 'huhu') {
      return Response.json({
        ok: true,
        sources: [
          {
            provider,
            providerName: 'Beta',
            type: 'hls',
            quality: 'Auto',
            url: 'https://media.example/beta/de.m3u8',
            audioTracks: [
              {
                label: 'German',
                language: 'de',
                switchUrl: 'https://media.example/beta/de.m3u8',
              },
              {
                label: 'English',
                language: 'en',
                switchUrl: 'https://media.example/beta/en.m3u8',
              },
            ],
          },
        ],
      })
    }
    if (provider === 'moviebox') {
      return Response.json({
        ok: true,
        sources: [
          {
            provider,
            providerName: 'Pi',
            type: 'mp4',
            quality: '1080p',
            url: 'https://media.example/pi/1080',
          },
        ],
      })
    }
    return new Response(JSON.stringify({ error: 'backend failed' }), {
      status: 500,
    })
  }) as typeof fetch

  try {
    const links = await vuflixProvider.streamMovie('533535')
    assert.deepEqual(queriedProviders.sort(), [
      'broken',
      'cinejoy',
      'cineplay',
      'huhu',
      'moviebox',
      'vaplayer',
      'vsembed',
    ])
    assert.equal(
      links.filter(link => link.server.includes('Alpha (vaplayer)')).length,
      2
    )
    assert.deepEqual(
      links
        .filter(link => link.server.includes('Alpha (vaplayer)'))
        .map(link => link.quality),
      ['1080p', '720p']
    )
    assert.equal(
      links.filter(link => link.server.includes('Beta (huhu)')).length,
      2
    )
    assert.match(
      links.find(link => link.url.endsWith('/beta/en.m3u8'))!.server,
      /English/
    )
    assert.equal(links[0].subtitles[0].label, 'English')
    assert.equal(
      links.find(link => link.server.includes('Pi (moviebox)'))!.isM3U8,
      false
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Vuflix sends TV coordinates and rejects invalid episodes', async () => {
  const originalFetch = globalThis.fetch
  let sourceUrl: URL | undefined

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.pathname === '/api/player/providers') {
      return Response.json({ providers: [{ id: 'cineplay', name: '4K' }] })
    }
    sourceUrl = url
    return Response.json({
      ok: true,
      sources: [
        {
          provider: 'cineplay',
          providerName: '4K',
          type: 'hls',
          quality: '2160p',
          url: 'https://media.example/tv/2160.m3u8',
        },
      ],
    })
  }) as typeof fetch

  try {
    assert.deepEqual(await vuflixProvider.streamTV('108978', 1, 0), [])
    const links = await vuflixProvider.streamTV('108978', 2, 3)
    assert.equal(sourceUrl?.searchParams.get('type'), 'tv')
    assert.equal(sourceUrl?.searchParams.get('tmdbId'), '108978')
    assert.equal(sourceUrl?.searchParams.get('season'), '2')
    assert.equal(sourceUrl?.searchParams.get('episode'), '3')
    assert.equal(sourceUrl?.searchParams.get('provider'), 'cineplay')
    assert.equal(links[0].quality, '2160p')
  } finally {
    globalThis.fetch = originalFetch
  }
})
