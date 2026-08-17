import assert from 'node:assert/strict'
import test from 'node:test'

process.env.TMDB_API_KEY = 'test-key'

import { artemisProvider } from './artemis.js'

test('Artemis follows the live Vault movie and TV lookup protocol', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: URL; init?: RequestInit }> = []

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    calls.push({ url, init })

    if (url.origin === 'https://api.themoviedb.org') {
      if (url.pathname === '/3/movie/634649') {
        return Response.json({ imdb_id: 'tt10872600' })
      }
      if (url.pathname === '/3/tv/2316/external_ids') {
        return Response.json({ imdb_id: 'tt0386676' })
      }
      if (url.pathname === '/3/movie/999999') {
        return new Response(JSON.stringify({ success: false }), { status: 404 })
      }
    }

    if (
      url.origin === 'https://stream.fontaine.lol' &&
      url.pathname === '/vault'
    ) {
      const type = url.searchParams.get('type')
      if (type === 'movie' && url.searchParams.get('tmdbId') === '634649') {
        return Response.json({
          sources: {
            Quartz: {
              url: 'https://media.example/quartz/master.m3u8',
              type: 'hls',
            },
            Andesite: {
              url: 'https://media.example/andesite/movie.mp4',
              type: 'mp4',
            },
          },
        })
      }
      if (type === 'tv' && url.searchParams.get('seasonId') === '2') {
        return Response.json({
          sources: {
            Andesite: { url: 'https://media.example/show/master.m3u8' },
          },
        })
      }
      return new Response(JSON.stringify({ sources: {} }), { status: 200 })
    }

    return new Response(JSON.stringify({ found: false }), { status: 404 })
  }) as typeof fetch

  try {
    const movieLinks = await artemisProvider.streamMovie('634649')
    const showLinks = await artemisProvider.streamTV('2316', 2, 3)
    const missingLinks = await artemisProvider.streamMovie('999999')
    const invalidLinks = await artemisProvider.streamTV('not-an-id', 0, 1)

    const vaultCalls = calls.filter(url => url.url.pathname === '/vault')
    assert.equal(vaultCalls.length, 2)

    assert.equal(vaultCalls[0].url.origin, 'https://stream.fontaine.lol')
    assert.equal(vaultCalls[0].url.searchParams.get('tmdbId'), '634649')
    assert.equal(vaultCalls[0].url.searchParams.get('imdbId'), 'tt10872600')
    assert.equal(vaultCalls[0].url.searchParams.get('type'), 'movie')
    assert.equal(vaultCalls[1].url.searchParams.get('type'), 'tv')
    assert.equal(vaultCalls[1].url.searchParams.get('seasonId'), '2')
    assert.equal(vaultCalls[1].url.searchParams.get('episodeId'), '3')

    const headers = new Headers(vaultCalls[0].init?.headers)
    assert.equal(headers.get('Referer'), 'https://zstream.mov/')
    assert.match(headers.get('User-Agent') || '', /Chrome\/149/)

    assert.equal(movieLinks.length, 2)
    assert.equal(movieLinks[0].server, 'ZStream | Vault · Quartz')
    assert.equal(movieLinks[0].isM3U8, true)
    assert.equal(movieLinks[1].isM3U8, false)
    assert.equal(showLinks.length, 1)
    assert.equal(showLinks[0].url, 'https://media.example/show/master.m3u8')
    assert.equal(showLinks[0].isM3U8, true)
    assert.deepEqual(missingLinks, [])
    assert.deepEqual(invalidLinks, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})
