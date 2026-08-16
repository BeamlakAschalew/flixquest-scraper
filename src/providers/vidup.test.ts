import assert from 'node:assert/strict'
import test from 'node:test'
import { vidUpProvider } from './vidup.js'
import {
  DEFAULT_FORWARD_PROXY_URL,
  setupForwardProxyPatch,
} from '../utils/forward-proxy.js'

test('VidUp keeps its CSRF-protected POST handshake on the forward proxy', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{
    targetUrl: string
    method: string
    headers: Headers
  }> = []

  globalThis.fetch = async (input, init) => {
    const requestUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    const proxyUrl = new URL(requestUrl)
    assert.equal(
      `${proxyUrl.origin}${proxyUrl.pathname}?url=`,
      DEFAULT_FORWARD_PROXY_URL
    )

    const targetUrl = proxyUrl.searchParams.get('url')
    assert.ok(targetUrl)
    const headers = new Headers(
      init?.headers || (input instanceof Request ? input.headers : undefined)
    )
    requests.push({
      targetUrl,
      method: init?.method || (input instanceof Request ? input.method : 'GET'),
      headers,
    })

    if (targetUrl.includes('/tv/2316/1/1')) {
      return new Response(
        '<script>self.__next={"en":"encoded-config"}</script>'
      )
    }
    if (targetUrl.includes('/enc-vidup?')) {
      return Response.json({
        result: {
          servers: 'https://vidup.to/gut/servers-token',
          stream: 'https://vidup.to/gut/stream-token',
          token: 'csrf-token',
        },
      })
    }
    if (targetUrl === 'https://vidup.to/gut/servers-token') {
      return new Response('encrypted-servers')
    }
    if (targetUrl === 'https://enc-dec.app/api/dec-vidup') {
      const body = JSON.parse(String(init?.body)) as { text: string }
      return Response.json({
        result:
          body.text === 'encrypted-servers'
            ? [{ name: 'Euro', data: 'server-data' }]
            : {
                url: 'https://media.example/video/master.m3u8',
                tracks: [],
              },
      })
    }
    if (targetUrl === 'https://vidup.to/gut/stream-token/server-data') {
      return new Response('encrypted-stream')
    }

    throw new Error(`Unexpected request: ${targetUrl}`)
  }

  setupForwardProxyPatch()

  try {
    const links = await vidUpProvider.streamTV('2316', 1, 1)
    assert.equal(links.length, 1)
    assert.equal(links[0].url, 'https://media.example/video/master.m3u8')

    const vidUpPosts = requests.filter(
      request =>
        request.method === 'POST' &&
        request.targetUrl.startsWith('https://vidup.to/gut/')
    )
    assert.equal(vidUpPosts.length, 2)
    for (const request of vidUpPosts) {
      assert.equal(request.headers.get('X-Csrf-Token'), 'csrf-token')
      assert.equal(request.headers.get('x-skip-forward-proxy'), null)
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})
