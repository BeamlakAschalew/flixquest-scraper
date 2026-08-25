import assert from 'node:assert/strict'
import test from 'node:test'
import { streamFlixProvider } from './streamflix.js'

test('StreamFlix uses the current config and exact TMDB catalog match', async () => {
  const originalFetch = globalThis.fetch
  const requestedUrls: string[] = []

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input.toString()
    requestedUrls.push(url)

    if (url === 'https://api.streamflix.app/data.json') {
      return Response.json({
        data: [
          {
            isTV: false,
            moviekey: 'fight-club',
            movielink: 'movies/1999/fightclub.mkv',
            moviename: 'Fight Club',
            movieyear: '1999',
            tmdb: '550',
          },
        ],
      })
    }
    if (url === 'https://api.streamflix.app/config/config-streamflix2.json') {
      return Response.json({
        movies: ['https://s1.streamflixapi.site/'],
        tv: ['https://s2.streamflixapi.site/'],
        premium: ['https://s1.streamflixapi.site/'],
        download: ['https://s3.streamflixapi.site/'],
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  }) as typeof fetch

  try {
    const links = await streamFlixProvider.streamMovie('550')

    assert.deepEqual(requestedUrls.sort(), [
      'https://api.streamflix.app/config/config-streamflix2.json',
      'https://api.streamflix.app/data.json',
    ])
    assert.deepEqual(
      links.map(link => link.url),
      [
        'https://s1.streamflixapi.site/movies/1999/fightclub.mkv',
        'https://s3.streamflixapi.site/movies/1999/fightclub.mkv',
        'https://s2.streamflixapi.site/movies/1999/fightclub.mkv',
      ]
    )
    assert.deepEqual(
      links.map(link => link.quality),
      ['1080p', '720p', '720p']
    )
    assert.match(links[0].server, /Premium/)
    assert.ok(links.every(link => !link.url.includes('streamflixserver.site')))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('StreamFlix TV full mode includes every fallback host', async () => {
  const moduleUrl = './streamflix.js?full-tv-hosts'
  const { streamFlixProvider } = (await import(
    moduleUrl
  )) as typeof import('./streamflix.js')
  const originalFetch = globalThis.fetch
  const originalWebSocket = globalThis.WebSocket

  globalThis.WebSocket = undefined as unknown as typeof WebSocket
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input.toString()
    if (url === 'https://api.streamflix.app/data.json') {
      return Response.json({
        data: [
          {
            isTV: true,
            moviekey: 'the-office',
            moviename: 'The Office',
            tmdb: '2316',
          },
        ],
      })
    }
    if (url === 'https://api.streamflix.app/config/config-streamflix2.json') {
      return Response.json({
        download: ['https://s8.streamflixserver.site/'],
        tv: ['https://s7.streamflixserver.site/'],
        premium: ['https://legacy.streamflix.example/'],
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  }) as typeof fetch

  try {
    const defaultLinks = await streamFlixProvider.streamTV('2316', 1, 1)
    const fullLinks = await streamFlixProvider.streamTV('2316', 1, 1, {
      full: true,
    })
    assert.deepEqual(
      defaultLinks.map(link => new URL(link.url).hostname),
      ['s8.streamflixserver.site']
    )
    assert.deepEqual(
      fullLinks.map(link => new URL(link.url).hostname),
      [
        's8.streamflixserver.site',
        's7.streamflixserver.site',
        'legacy.streamflix.example',
      ]
    )
  } finally {
    globalThis.fetch = originalFetch
    globalThis.WebSocket = originalWebSocket
  }
})

test('StreamFlix full mode includes every configured host', async () => {
  const moduleUrl = './streamflix.js?full-hosts'
  const { streamFlixProvider } = (await import(
    moduleUrl
  )) as typeof import('./streamflix.js')
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input.toString()
    if (url === 'https://api.streamflix.app/data.json') {
      return Response.json({
        data: [
          {
            isTV: false,
            movielink: 'movies/fight-club.mkv',
            moviename: 'Fight Club',
            tmdb: '550',
          },
        ],
      })
    }
    if (url === 'https://api.streamflix.app/config/config-streamflix2.json') {
      return Response.json({
        premium: ['https://s8.streamflixserver.site/'],
        movies: ['https://s7.streamflixserver.site/'],
        download: ['https://legacy.streamflix.example/'],
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  }) as typeof fetch

  try {
    const defaultLinks = await streamFlixProvider.streamMovie('550')
    const fullLinks = await streamFlixProvider.streamMovie('550', {
      full: true,
    })

    assert.deepEqual(
      defaultLinks.map(link => new URL(link.url).hostname),
      ['s8.streamflixserver.site']
    )
    assert.deepEqual(
      fullLinks.map(link => new URL(link.url).hostname),
      [
        's8.streamflixserver.site',
        's7.streamflixserver.site',
        'legacy.streamflix.example',
      ]
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
