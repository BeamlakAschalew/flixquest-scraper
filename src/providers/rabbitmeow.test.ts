import assert from 'node:assert/strict'
import test from 'node:test'

import { getRawProvider } from './index.js'
import { oneElevenMoviesProvider } from './111movies.js'

test('RabbitMeow sources are registered as individual providers', () => {
  const expected = [
    ['primesrc', 'PrimeSrc'],
    ['smashystream', 'SmashyStream'],
    ['2embed', '2Embed'],
    ['multiembed', 'MultiEmbed'],
    ['111movies', '111Movies'],
  ] as const

  for (const [id, name] of expected) {
    const provider = getRawProvider(id)
    assert.ok(provider)
    assert.equal(provider.id, id)
    assert.equal(provider.name, name)
  }
})

test('111Movies resolves extensionless signed URLs with fetch only', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: URL; init?: RequestInit }> = []

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    calls.push({ url, init })
    return Response.json({
      subtitles: [
        { label: 'English', file: 'https://subs.example/english.vtt' },
      ],
      source: {
        source: 'moviebox',
        label: 'MovieBox',
        qualities: [
          {
            quality: '1080p',
            codec: 'hevc',
            url: 'https://media.example/signed/playback?token=abc123',
          },
        ],
      },
    })
  }) as typeof fetch

  try {
    const links = await oneElevenMoviesProvider.streamMovie('634649')

    assert.equal(calls.length, 1)
    assert.equal(calls[0].url.pathname, '/movie')
    assert.equal(calls[0].url.searchParams.get('id'), '634649')
    assert.equal(calls[0].url.searchParams.get('mode'), 'json')
    assert.equal(
      new Headers(calls[0].init?.headers).get('Referer'),
      'https://player.vidlove.cc/'
    )
    assert.equal(links.length, 1)
    assert.equal(
      links[0].url,
      'https://media.example/signed/playback?token=abc123'
    )
    assert.equal(links[0].quality, '1080p')
    assert.equal(links[0].subtitles[0].label, 'English')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('standalone providers reject invalid media requests before fetching', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    throw new Error('unexpected fetch')
  }) as typeof fetch

  try {
    assert.deepEqual(
      await oneElevenMoviesProvider.streamMovie('not-a-tmdb-id'),
      []
    )
    assert.deepEqual(await oneElevenMoviesProvider.streamTV('97546', 0, 1), [])
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
