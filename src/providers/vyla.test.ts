import assert from 'node:assert/strict'
import test from 'node:test'
import { vylaProvider } from './vyla.js'

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=600000,RESOLUTION=640x360
360/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480
480/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720
720/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4800000,RESOLUTION=1920x1080
1080/index.m3u8
`

function mp4Header(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(128)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 92)
  bytes.set([0x74, 0x6b, 0x68, 0x64], 4)
  view.setUint32(84, width * 65_536)
  view.setUint32(88, height * 65_536)
  return bytes
}

test('Vyla resolves direct movie MP4 and TV HLS qualities up to 1080p', async () => {
  const originalFetch = globalThis.fetch
  const sourceRequests: URL[] = []

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.hostname === 'auth.vyla.cc') {
      return Response.json({ token: 'session-token' })
    }
    if (url.hostname === 'api.vyla.cc') {
      sourceRequests.push(url)
      assert.equal(
        new Headers(init?.headers).get('X-Session-Token'),
        'session-token'
      )
      const source = url.searchParams.get('source')
      if (url.pathname.endsWith('/550') && source === 'vidnest') {
        return Response.json({
          ok: true,
          raw_url: 'https://media.vyla.example/movie.mp4',
        })
      }
      if (url.pathname.endsWith('/1396') && source === 'lookmovie') {
        return Response.json({
          ok: false,
          raw_url: 'https://media.vyla.example/tv/master.m3u8',
        })
      }
      return Response.json({ ok: false, raw_url: null })
    }
    if (url.pathname === '/movie.mp4') {
      return new Response(mp4Header(1920, 1080).buffer as ArrayBuffer, {
        status: 206,
        headers: { 'Content-Type': 'application/octet-stream' },
      })
    }
    if (url.pathname === '/tv/master.m3u8') {
      return new Response(MASTER, {
        headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
      })
    }
    return new Response('Not found', { status: 404 })
  }) as typeof fetch

  try {
    const [movie, episode] = await Promise.all([
      vylaProvider.streamMovie('550'),
      vylaProvider.streamTV('1396', 1, 1),
    ])

    assert.equal(movie.length, 1)
    assert.equal(movie[0]?.quality, '1080p')
    assert.equal(movie[0]?.url, 'https://media.vyla.example/movie.mp4')
    assert.deepEqual(
      episode.map(link => link.quality),
      ['360p', '480p', '720p', '1080p']
    )
    assert.equal(
      sourceRequests.some(
        url =>
          url.pathname.endsWith('/1396') &&
          url.searchParams.get('season') === '1' &&
          url.searchParams.get('episode') === '1'
      ),
      true
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Vyla rejects invalid media coordinates before authenticating', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return new Response('unexpected')
  }) as typeof fetch

  try {
    assert.deepEqual(await vylaProvider.streamMovie('bad-id'), [])
    assert.deepEqual(await vylaProvider.streamTV('1396', 0, 1), [])
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
