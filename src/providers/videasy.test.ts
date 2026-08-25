import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeSeedPayload } from './_shared/seed-cipher.js'

test('VidEasy full mode exhausts every configured server', async () => {
  const originalFetch = globalThis.fetch
  const originalApiKey = process.env.TMDB_API_KEY
  process.env.TMDB_API_KEY = 'test-key'
  const seed = 'test-seed'
  const attemptedServers: string[] = []
  const moduleUrl = './videasy.js?full-servers'
  const { vidEasyProvider } = (await import(
    moduleUrl
  )) as typeof import('./videasy.js')

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.hostname === 'api.themoviedb.org') {
      return Response.json({
        title: 'Fight Club',
        release_date: '1999-10-15',
        external_ids: { imdb_id: 'tt0137523' },
      })
    }
    if (url.pathname === '/seed') return Response.json({ seed })
    if (url.pathname.endsWith('/sources-with-title')) {
      const server = url.pathname.split('/')[1]
      attemptedServers.push(server)
      return new Response(
        encodeSeedPayload(
          {
            sources: [
              {
                url: `https://${server}.example/video.m3u8`,
                quality: '1080p',
              },
            ],
          },
          seed,
          550
        )
      )
    }
    throw new Error(`Unexpected request: ${url.href}`)
  }) as typeof fetch

  try {
    const defaultLinks = await vidEasyProvider.streamMovie('550')
    assert.deepEqual(attemptedServers, ['cdn'])
    assert.equal(defaultLinks.length, 1)
    attemptedServers.length = 0

    const links = await vidEasyProvider.streamMovie('550', { full: true })
    assert.deepEqual(attemptedServers, [
      'cdn',
      'lamovie',
      'm4uhd',
      'neon2',
      'superflix',
      'tejo',
      'downloader2',
      'ym',
      'mb-flix',
      '1movies',
    ])
    assert.equal(links.length, attemptedServers.length)
  } finally {
    globalThis.fetch = originalFetch
    if (originalApiKey === undefined) delete process.env.TMDB_API_KEY
    else process.env.TMDB_API_KEY = originalApiKey
  }
})
