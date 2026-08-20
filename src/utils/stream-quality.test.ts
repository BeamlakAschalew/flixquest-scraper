import assert from 'node:assert/strict'
import test from 'node:test'
import type { ProviderLink } from '../types/index.js'
import { resolveStreamQualities } from './stream-quality.js'

function link(overrides: Partial<ProviderLink>): ProviderLink {
  return {
    server: 'Test',
    url: 'https://media.example/master.m3u8',
    isM3U8: true,
    quality: 'auto',
    subtitles: [],
    ...overrides,
  }
}

test('expands HLS variants using link playback headers', async () => {
  const originalFetch = globalThis.fetch
  let requestHeaders: Headers | undefined

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestHeaders = new Headers(init?.headers)
    return new Response(
      '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio 1",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,AUDIO="audio"\n360p/playlist.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,AUDIO="audio"\n720p/playlist.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,AUDIO="audio"\n1080p/playlist.m3u8\n'
    )
  }) as typeof fetch

  try {
    const resolved = await resolveStreamQualities([
      link({
        headers: {
          'User-Agent': 'FlixQuest test',
          Referer: 'https://vidrock.example/',
        },
        subtitles: [
          {
            file: 'https://subs.example/en.vtt',
            label: 'English',
            kind: 'captions',
          },
        ],
      }),
    ])
    assert.deepEqual(
      resolved.map(candidate => ({
        url: candidate.url,
        quality: candidate.quality,
      })),
      [
        {
          url: 'https://media.example/360p/playlist.m3u8',
          quality: '360p',
        },
        {
          url: 'https://media.example/720p/playlist.m3u8',
          quality: '720p',
        },
        {
          url: 'https://media.example/1080p/playlist.m3u8',
          quality: '1080p',
        },
      ]
    )
    assert.equal(resolved[0].subtitles[0].label, 'English')
    assert.equal(
      resolved[1].sizeManifestUrl,
      'https://media.example/master.m3u8'
    )
    assert.equal(
      resolved[1].sizeHlsVariantUrl,
      'https://media.example/720p/playlist.m3u8'
    )
    assert.equal(resolved[1].sizeHlsAudioGroup, 'audio')
    assert.equal(requestHeaders?.get('user-agent'), 'FlixQuest test')
    assert.equal(requestHeaders?.get('referer'), 'https://vidrock.example/')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('categorizes Edmunds variants with vendor attributes and absolute paths', async () => {
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async () =>
    new Response(
      '#EXTM3U\r\n#EXT-X-INDEPENDENT-SEGMENTS\r\n#EXT-X-STREAM-INF:BANDWIDTH=814277,CODECS="mp4a.40.2,avc1.42c01e",RESOLUTION=640x360,FRAME-RATE=24,VIDEO-RANGE=SDR,YT-EXT-ABSOLUTE-LOUDNESS=-29.820,CLOSED-CAPTIONS=NONE\r\n/token/360/index.m3u8\r\n#EXT-X-STREAM-INF: BANDWIDTH=2947352, CODECS="mp4a.40.2,avc1.64001f", RESOLUTION = "1280x720", FRAME-RATE=24, VIDEO-RANGE=SDR\r\n/token/720/index.m3u8\r\n'
    )) as typeof fetch

  try {
    const resolved = await resolveStreamQualities([
      link({
        url: 'https://personalbrandgrowth.site/token/master.m3u8',
        server: 'Bingr | Edmunds | Original | Auto',
      }),
    ])

    assert.deepEqual(
      resolved.map(candidate => ({
        url: candidate.url,
        quality: candidate.quality,
      })),
      [
        {
          url: 'https://personalbrandgrowth.site/token/360/index.m3u8',
          quality: '360p',
        },
        {
          url: 'https://personalbrandgrowth.site/token/720/index.m3u8',
          quality: '720p',
        },
      ]
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('resolves DASH height and preserves already known quality', async () => {
  const originalFetch = globalThis.fetch
  let fetchCount = 0

  globalThis.fetch = (async () => {
    fetchCount++
    return new Response(
      '<MPD><Period><AdaptationSet contentType="video"><Representation width="1280" height="720"/><Representation width="1920" height="1080"/></AdaptationSet></Period></MPD>'
    )
  }) as typeof fetch

  try {
    const resolved = await resolveStreamQualities([
      link({
        url: 'https://media.example/stream.mpd',
        isM3U8: false,
        isDASH: true,
      }),
      link({ quality: '720p' }),
    ])
    assert.equal(resolved[0].quality, '1080p')
    assert.equal(resolved[1].quality, '720p')
    assert.equal(fetchCount, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('uses unknown when a generic quality cannot be revealed', async () => {
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async () =>
    new Response(
      '#EXTM3U\n#EXT-X-TARGETDURATION:6\nsegment.ts\n'
    )) as typeof fetch

  try {
    const resolved = await resolveStreamQualities([
      link({ quality: 'adaptive' }),
      link({ url: 'https://media.example/video.mp4', isM3U8: false }),
    ])
    assert.equal(resolved[0].quality, 'unknown')
    assert.equal(resolved[1].quality, 'unknown')
  } finally {
    globalThis.fetch = originalFetch
  }
})
