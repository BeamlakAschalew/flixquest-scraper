import assert from 'node:assert/strict'
import test from 'node:test'
import { cinejoyProvider } from './cinejoy.js'

test('discovers the Cinejoy gateway from the current watch route build', async () => {
  const originalFetch = globalThis.fetch
  const requestedUrls: string[] = []

  globalThis.fetch = async input => {
    const url = String(input)
    requestedUrls.push(url)

    if (url.startsWith('https://cinejoy.to/watch/movie/1081003')) {
      return new Response(
        '<link rel="modulepreload" href="/_app/immutable/entry/app.new-build.js">'
      )
    }
    if (url === 'https://cinejoy.to/_app/immutable/entry/app.new-build.js') {
      return new Response(
        'const m=["../nodes/7.watch-build.js"];const r={"/watch/movie/[id]":[7]};'
      )
    }
    if (url === 'https://cinejoy.to/_app/immutable/nodes/7.watch-build.js') {
      return new Response(
        'import{d as x}from"../chunks/unrelated.js";import{s as y}from"../chunks/gateway-random-hash.js";'
      )
    }
    if (url === 'https://cinejoy.to/_app/immutable/chunks/unrelated.js') {
      return new Response(
        'const first=1,second=2,third=3;export{first as d,second as n,third as o};'
      )
    }
    if (
      url === 'https://cinejoy.to/_app/immutable/chunks/gateway-random-hash.js'
    ) {
      return new Response(
        'import{a as Store}from"./settings-random.js";const servers=async()=>[{name:"Current"}];const movie=async()=>({stream:[{type:"hls",playlist:"https://cdn.example/current.m3u8"}]});const tv=async()=>({stream:[]});export{servers as d,movie as n,tv as o};'
      )
    }
    return new Response('Not found', { status: 404 })
  }

  try {
    const links = await cinejoyProvider.streamMovie!('1081003')
    assert.equal(links.length, 1)
    assert.equal(links[0].url, 'https://cdn.example/current.m3u8')
    assert.ok(
      requestedUrls.includes(
        'https://cinejoy.to/_app/immutable/chunks/gateway-random-hash.js'
      )
    )
    assert.ok(!requestedUrls.some(url => url.includes('BOqDcafn.js')))
  } finally {
    globalThis.fetch = originalFetch
  }
})
