import assert from 'node:assert/strict'
import test from 'node:test'
import { fshareTvProvider } from './fsharetv.js'

test('FshareTV resolves one direct MP4 per explicit quality', async () => {
  const originalFetch = globalThis.fetch
  const originalTmdbKey = process.env.TMDB_API_KEY
  const calls: URL[] = []
  process.env.TMDB_API_KEY = 'test-key'

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    calls.push(url)

    if (url.hostname === 'api.themoviedb.org') {
      return Response.json({ imdb_id: 'tt0137523' })
    }
    if (url.pathname === '/w/tt0137523') {
      return new Response(`
        <input type="hidden" id="trailer" value="trailer-token">
        <script>Movie.setSource('source+token==', 720, "watch")</script>
      `)
    }
    if (
      url.pathname.startsWith('/api/file/') &&
      url.pathname.endsWith('/source')
    ) {
      assert.equal(url.searchParams.get('trailer'), 'trailer-token')
      assert.equal(url.searchParams.get('type'), 'watch')
      assert.equal(
        new Headers(init?.headers).get('X-Requested-With'),
        'XMLHttpRequest'
      )
      return Response.json({
        status: 'ok',
        data: {
          file: {
            sources: [
              {
                src: '/api/media/1080',
                label: '1080p',
                type: 'video/mp4',
                quality: 1080,
                storage: 'primary',
              },
              {
                src: '/api/media/720',
                label: '720p',
                type: 'video/mp4',
                quality: 720,
              },
            ],
            alternatives: [
              [
                {
                  src: '/api/media/1080-mirror',
                  label: '1080p',
                  type: 'video/mp4',
                },
                {
                  src: '/api/media/480',
                  label: '480p',
                  type: 'video/mp4',
                },
                {
                  src: '/api/media/360',
                  label: '360p',
                  type: 'video/mp4',
                },
              ],
            ],
          },
        },
      })
    }
    return new Response('Not found', { status: 404 })
  }) as typeof fetch

  try {
    const links = await fshareTvProvider.streamMovie('550')
    assert.deepEqual(
      links.map(link => link.quality),
      ['1080p', '720p', '480p', '360p']
    )
    assert.equal(links.length, 4)
    assert.equal(links[0].url, 'https://fsharetv.co/api/media/1080')
    assert.equal(links[0].requiresProxy, true)
    assert.equal(links[0].headers?.Referer, 'https://fsharetv.co/w/tt0137523')
    assert.equal(calls.length, 3)
    assert.deepEqual(await fshareTvProvider.streamTV('1396', 1, 1), [])
  } finally {
    globalThis.fetch = originalFetch
    if (originalTmdbKey === undefined) delete process.env.TMDB_API_KEY
    else process.env.TMDB_API_KEY = originalTmdbKey
  }
})

test('FshareTV rejects invalid TMDB IDs before fetching', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    throw new Error('unexpected fetch')
  }) as typeof fetch

  try {
    assert.deepEqual(await fshareTvProvider.streamMovie('invalid'), [])
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
