import assert from 'node:assert/strict'
import test from 'node:test'
import type { ProviderLink } from '../types/index.js'
import { createStreamSizeToken, estimateStreamSize } from './stream-size.js'

function link(overrides: Partial<ProviderLink> = {}): ProviderLink {
  return {
    server: 'Test',
    url: 'https://8.8.8.8/video/720.m3u8',
    isM3U8: true,
    quality: '720p',
    subtitles: [],
    sizeManifestUrl: 'https://8.8.8.8/master.m3u8',
    sizeHlsVariantUrl: 'https://8.8.8.8/video/720.m3u8',
    ...overrides,
  }
}

test('estimates HLS from manifest average bandwidth without requesting segments', async () => {
  const originalFetch = globalThis.fetch
  const originalSecret = process.env.STREAM_PROXY_SECRET
  process.env.STREAM_PROXY_SECRET = 'stream-size-test-secret'
  const requested: string[] = []

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    requested.push(url.pathname)
    if (url.pathname === '/master.m3u8') {
      return new Response(
        '#EXTM3U\n' +
          '#EXT-X-STREAM-INF:BANDWIDTH=800000,AVERAGE-BANDWIDTH=700000,RESOLUTION=640x360\nvideo/360.m3u8\n' +
          '#EXT-X-STREAM-INF:BANDWIDTH=2800000,AVERAGE-BANDWIDTH=2400000,RESOLUTION=1280x720\nvideo/720.m3u8\n' +
          '#EXT-X-STREAM-INF:BANDWIDTH=5000000,AVERAGE-BANDWIDTH=4400000,RESOLUTION=1920x1080\nvideo/1080.m3u8\n'
      )
    }
    if (url.pathname === '/video/720.m3u8') {
      return new Response(
        '#EXTM3U\n#EXTINF:6,\nsegment-1.ts\n#EXTINF:6,\nsegment-2.ts\n#EXT-X-ENDLIST\n'
      )
    }
    throw new Error(`A segment request was attempted: ${url.pathname}`)
  }) as typeof fetch

  try {
    const estimate = await estimateStreamSize(createStreamSizeToken(link()))
    assert.equal(estimate.estimatedBytes, 3_636_000)
    assert.equal(estimate.confidence, 'high')
    assert.equal(estimate.method, 'hls-average-bandwidth')
    assert.equal(estimate.bitrate, 2_400_000)
    assert.equal(estimate.durationSeconds, 12)
    assert.equal(estimate.segmentCount, 2)
    assert.deepEqual(requested, ['/master.m3u8', '/video/720.m3u8'])
  } finally {
    globalThis.fetch = originalFetch
    if (originalSecret === undefined) delete process.env.STREAM_PROXY_SECRET
    else process.env.STREAM_PROXY_SECRET = originalSecret
  }
})

test('uses EXT-X-BITRATE when a media playlist has no master bandwidth', async () => {
  const originalFetch = globalThis.fetch
  const originalSecret = process.env.STREAM_PROXY_SECRET
  process.env.STREAM_PROXY_SECRET = 'stream-size-test-secret'

  globalThis.fetch = (async () =>
    new Response(
      '#EXTM3U\n#EXTINF:5,\n#EXT-X-BITRATE:1000\none.ts\n' +
        '#EXTINF:10,\n#EXT-X-BITRATE:2000\ntwo.ts\n#EXT-X-ENDLIST\n'
    )) as typeof fetch

  try {
    const estimate = await estimateStreamSize(
      createStreamSizeToken(
        link({
          url: 'https://8.8.8.8/media.m3u8',
          sizeManifestUrl: undefined,
          sizeHlsVariantUrl: undefined,
          quality: 'unknown',
        })
      )
    )
    assert.equal(estimate.method, 'hls-segment-bitrate')
    assert.equal(estimate.bitrate, 5_000_000 / 3)
    assert.equal(estimate.durationSeconds, 15)
  } finally {
    globalThis.fetch = originalFetch
    if (originalSecret === undefined) delete process.env.STREAM_PROXY_SECRET
    else process.env.STREAM_PROXY_SECRET = originalSecret
  }
})

test('estimates HLS from distributed one-byte segment probes', async () => {
  const originalFetch = globalThis.fetch
  const originalSecret = process.env.STREAM_PROXY_SECRET
  process.env.STREAM_PROXY_SECRET = 'stream-size-test-secret'
  const requests: Array<{ path: string; range: string | null }> = []
  const durations = [4, 8, 4, 8, 4, 8, 4, 8, 4, 8]
  const manifest = [
    '#EXTM3U',
    ...durations.flatMap((duration, index) => [
      `#EXTINF:${duration},`,
      `segment-${index}.ts`,
    ]),
    '#EXT-X-ENDLIST',
  ].join('\n')

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    const headers = new Headers(init?.headers)
    requests.push({ path: url.pathname, range: headers.get('range') })
    if (url.pathname === '/media.m3u8') return new Response(manifest)

    const index = Number(url.pathname.match(/segment-(\d+)\.ts$/)?.[1])
    assert.equal(headers.get('range'), 'bytes=0-0')
    assert.ok(Number.isSafeInteger(index))
    const totalLength = (durations[index] * 1_000_000) / 8
    return new Response(null, {
      status: 206,
      headers: { 'Content-Range': `bytes 0-0/${totalLength}` },
    })
  }) as typeof fetch

  try {
    const estimate = await estimateStreamSize(
      createStreamSizeToken(
        link({
          url: 'https://8.8.8.8/media.m3u8',
          sizeManifestUrl: undefined,
          sizeHlsVariantUrl: undefined,
        })
      )
    )
    assert.equal(estimate.method, 'hls-segment-sample')
    assert.equal(estimate.confidence, 'medium')
    assert.equal(estimate.bitrate, 1_000_000)
    assert.equal(estimate.estimatedBytes, 7_575_000)
    assert.equal(estimate.sampledSegments, 7)
    assert.equal(estimate.successfulSamples, 7)
    assert.equal(estimate.sampledDurationSeconds, 44)
    assert.equal(requests[0].path, '/media.m3u8')
    assert.equal(requests[0].range, null)
    assert.equal(requests.length, 8)
    assert.ok(requests.slice(1).every(request => request.range === 'bytes=0-0'))
  } finally {
    globalThis.fetch = originalFetch
    if (originalSecret === undefined) delete process.env.STREAM_PROXY_SECRET
    else process.env.STREAM_PROXY_SECRET = originalSecret
  }
})

test('falls back to selected resolution when segment range probes are unavailable', async () => {
  const originalFetch = globalThis.fetch
  const originalSecret = process.env.STREAM_PROXY_SECRET
  process.env.STREAM_PROXY_SECRET = 'stream-size-test-secret'
  let probeCount = 0
  const manifest = [
    '#EXTM3U',
    ...Array.from({ length: 10 }, (_, index) => [
      '#EXTINF:6,',
      `segment-${index}.ts`,
    ]).flat(),
    '#EXT-X-ENDLIST',
  ].join('\n')

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.pathname === '/media.m3u8') return new Response(manifest)
    assert.equal(new Headers(init?.headers).get('range'), 'bytes=0-0')
    probeCount++
    return new Response(null, { status: 200 })
  }) as typeof fetch

  try {
    const estimate = await estimateStreamSize(
      createStreamSizeToken(
        link({
          url: 'https://8.8.8.8/media.m3u8',
          sizeManifestUrl: undefined,
          sizeHlsVariantUrl: undefined,
        })
      )
    )
    assert.equal(estimate.method, 'resolution-fallback')
    assert.equal(estimate.confidence, 'low')
    assert.equal(estimate.bitrate, 3_000_000)
    assert.equal(estimate.estimatedBytes, 22_725_000)
    assert.equal(estimate.successfulSamples, 0)
    assert.equal(probeCount, 7)
  } finally {
    globalThis.fetch = originalFetch
    if (originalSecret === undefined) delete process.env.STREAM_PROXY_SECRET
    else process.env.STREAM_PROXY_SECRET = originalSecret
  }
})

test('rejects tampered stream size tokens', async () => {
  const originalSecret = process.env.STREAM_PROXY_SECRET
  process.env.STREAM_PROXY_SECRET = 'stream-size-test-secret'
  try {
    const token = createStreamSizeToken(link())
    await assert.rejects(estimateStreamSize(`${token}x`), /Invalid size token/)
  } finally {
    if (originalSecret === undefined) delete process.env.STREAM_PROXY_SECRET
    else process.env.STREAM_PROXY_SECRET = originalSecret
  }
})
