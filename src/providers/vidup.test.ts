import assert from 'node:assert/strict'
import test from 'node:test'
import { vidUpProvider } from './vidup.js'
import {
  DEFAULT_FORWARD_PROXY_URL,
  FALLBACK_FORWARD_PROXY_URL,
  setupForwardProxyPatch,
} from '../utils/forward-proxy.js'

test('VidUp keeps its CSRF-protected POST handshake on the forward proxy', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{
    proxyUrl: string
    targetUrl: string
    method: string
    headers: Headers
    body?: string
  }> = []
  let primaryFailureTriggered = false

  globalThis.fetch = async (input, init) => {
    const request =
      input instanceof Request ? input : new Request(input.toString(), init)
    const proxyUrl = new URL(request.url)
    const proxyBaseUrl = `${proxyUrl.origin}${proxyUrl.pathname}?url=`
    assert.ok(
      [DEFAULT_FORWARD_PROXY_URL, FALLBACK_FORWARD_PROXY_URL].includes(
        proxyBaseUrl
      )
    )

    const targetUrl = proxyUrl.searchParams.get('url')
    assert.ok(targetUrl)
    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await request.clone().text()
    requests.push({
      proxyUrl: proxyBaseUrl,
      targetUrl,
      method: request.method,
      headers: request.headers,
      body,
    })

    if (
      targetUrl === 'https://enc-dec.app/api/dec-vidup' &&
      proxyBaseUrl === DEFAULT_FORWARD_PROXY_URL &&
      !primaryFailureTriggered
    ) {
      primaryFailureTriggered = true
      throw new TypeError('simulated primary proxy failure')
    }

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
      const decodedBody = JSON.parse(body || '{}') as { text?: string }
      return Response.json({
        result:
          decodedBody.text === 'encrypted-servers'
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
    assert.equal(primaryFailureTriggered, true)

    const retriedDecryptRequests = requests.filter(
      request =>
        request.targetUrl === 'https://enc-dec.app/api/dec-vidup' &&
        request.body?.includes('encrypted-servers')
    )
    assert.equal(retriedDecryptRequests.length, 2)
    assert.deepEqual(
      retriedDecryptRequests.map(request => request.proxyUrl),
      [DEFAULT_FORWARD_PROXY_URL, FALLBACK_FORWARD_PROXY_URL]
    )
    assert.equal(retriedDecryptRequests[0].method, 'POST')
    assert.equal(retriedDecryptRequests[1].method, 'POST')
    assert.equal(
      retriedDecryptRequests[1].headers.get('content-type'),
      retriedDecryptRequests[0].headers.get('content-type')
    )
    assert.equal(retriedDecryptRequests[1].body, retriedDecryptRequests[0].body)

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
