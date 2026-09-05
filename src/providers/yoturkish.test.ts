import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeYoTurkishPlayerData, yoTurkishProvider } from './yoturkish.js'

test('decodes YoTurkish chunked player data', () => {
  const encoded =
    'bhQqV|yE1FBxwWW8WW|D0IYioOQGQ|HKAVUPQspV1|N5Wx9vEit|fBz8OTzke|bRZje|WBPNxM/YRE|4EF4qEW0WN|jo0DQ|okH2VicBUMfQ|wsVUU8F1I|1CCZaIClO|HHIePUw|fQ0kKO|R1AGFF4Ww|1rTXpMCzY|UYkRPbxtj|a1wfb|wdBXAwmS|2I/ED9aDG8|='
  assert.equal(
    decodeYoTurkishPlayerData(encoded),
    '<iframe width="100%" height="100%" src="https://rufiiguta.com/?v=3SRuR0Ic_" frameborder="0" scrolling="0" allowfullscreen=""></iframe>'
  )
})

function encodePlayerData(value: string): string {
  const key = [86, 110, 51, 72, 106, 87, 56, 102]
  const bytes = Uint8Array.from(
    Array.from(
      value,
      (character, index) =>
        (character.charCodeAt(0) ^ key[index % key.length]) + 5
    )
  ).reverse()
  return Buffer.from(bytes).toString('base64')
}

test('YoTurkish uses one player embed by default and all embeds in full mode', async () => {
  const originalFetch = globalThis.fetch
  const originalApiKey = process.env.TMDB_API_KEY
  process.env.TMDB_API_KEY = 'test-key'
  const embedRequests: string[] = []
  let firstEmbedWorks = false
  const encodedFirst = encodePlayerData(
    '<iframe src="https://player.example/first"></iframe>'
  )
  const encodedSecond = encodePlayerData(
    '<iframe src="https://player.example/second"></iframe>'
  )

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.hostname === 'api.themoviedb.org') {
      return Response.json({ name: 'Test Show', first_air_date: '2020-01-01' })
    }
    if (url.hostname === 'yoturkish.to' && url.pathname === '/') {
      return new Response(
        '<div class="item"><h3><a class="title" href="https://yoturkish.to/test-show/">Test Show</a></h3></div>'
      )
    }
    if (url.href === 'https://yoturkish.to/test-show/') {
      return new Response(
        '<a class="episod" href="https://yoturkish.to/test-show-season-1-episode-1/">Season 1 Episode 1</a>'
      )
    }
    if (url.href === 'https://yoturkish.to/test-show-season-1-episode-1/') {
      return new Response(
        `<div data-s1="${encodedFirst}" data-s2="${encodedSecond}"></div>`
      )
    }
    if (url.hostname === 'player.example') {
      embedRequests.push(url.pathname)
      if (url.pathname === '/first' && !firstEmbedWorks) {
        return new Response('<html></html>')
      }
      return new Response(
        `<video src="https://media.example${url.pathname}.m3u8"></video>`
      )
    }
    return new Response('Not found', { status: 404 })
  }) as typeof fetch

  try {
    const defaultLinks = await yoTurkishProvider.streamTV('123', 1, 1)
    assert.deepEqual(embedRequests, ['/first', '/second'])
    assert.equal(defaultLinks.length, 1)

    firstEmbedWorks = true
    embedRequests.length = 0
    const fullLinks = await yoTurkishProvider.streamTV('123', 1, 1, {
      full: true,
    })
    assert.deepEqual(embedRequests, ['/first', '/second'])
    assert.equal(fullLinks.length, 2)
  } finally {
    globalThis.fetch = originalFetch
    if (originalApiKey === undefined) delete process.env.TMDB_API_KEY
    else process.env.TMDB_API_KEY = originalApiKey
  }
})
