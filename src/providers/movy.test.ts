import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeSeedPayload } from './_shared/seed-cipher.js'

test('Movy full mode exhausts every configured server', async () => {
  const originalFetch = globalThis.fetch
  const originalApiKey = process.env.TMDB_API_KEY
  process.env.TMDB_API_KEY = 'test-key'
  const seed = 'test-seed'
  const attemptedServers: string[] = []
  const moduleUrl = './movy.js?full-servers'
  const { movyProvider } = (await import(
    moduleUrl
  )) as typeof import('./movy.js')

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.hostname === 'api.themoviedb.org') {
      return Response.json({
        title: 'Fight Club',
        release_date: '1999-10-15',
        imdb_id: 'tt0137523',
      })
    }
    if (url.pathname === '/seed') return Response.json({ seed })
    if (url.pathname.endsWith('/sources')) {
      const server = url.pathname.split('/')[1]
      attemptedServers.push(server)
      const source =
        server === 'denver'
          ? {
              url: `https://${server}.example/video.mpd`,
              quality: '1080p',
              type: 'dash',
            }
          : {
              url: `https://${server}.example/video.m3u8`,
              quality:
                server === 'austin'
                  ? 'English'
                  : server === 'delhi'
                    ? 'Hindi'
                    : '1080p',
            }
      return new Response(
        encodeSeedPayload(
          {
            sources: [source],
          },
          seed,
          550
        )
      )
    }
    throw new Error(`Unexpected request: ${url.href}`)
  }) as typeof fetch

  try {
    const defaultLinks = await movyProvider.streamMovie('550')
    assert.deepEqual(attemptedServers, ['miami'])
    assert.equal(defaultLinks.length, 1)
    attemptedServers.length = 0

    const links = await movyProvider.streamMovie('550', { full: true })
    assert.deepEqual(attemptedServers, [
      'miami',
      'denver',
      'seattle',
      'chicago',
      'portland',
      'austin',
      'atlanta',
      'houston',
      'phoenix',
      'dallas',
      'munich',
      'berlin',
      'paris',
      'delhi',
      'cancun',
    ])
    assert.equal(links.length, attemptedServers.length)
  } finally {
    globalThis.fetch = originalFetch
    if (originalApiKey === undefined) delete process.env.TMDB_API_KEY
    else process.env.TMDB_API_KEY = originalApiKey
  }
})
