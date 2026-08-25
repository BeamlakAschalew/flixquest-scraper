import assert from 'node:assert/strict'
import test from 'node:test'

for (const storeAlias of ['a', 'p']) {
  test(`discovers the Cinejoy gateway with store alias ${storeAlias}`, async () => {
    const { cinejoyProvider } = await import(
      `./cinejoy.js?store-alias=${storeAlias}`
    )
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
        url ===
        'https://cinejoy.to/_app/immutable/chunks/gateway-random-hash.js'
      ) {
        return new Response(
          `import{${storeAlias} as Store}from"./settings-random.js";const servers=async()=>[{name:"Current"}];const movie=async()=>({stream:[{type:"hls",playlist:"https://cdn.example/current.m3u8"}]});const tv=async()=>({stream:[]});export{servers as d,movie as n,tv as o};`
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
}

test('keeps Lisbon HLS audio renditions attached to every quality', async () => {
  const moduleUrl = './cinejoy.js?lisbon-audio'
  const { cinejoyProvider } = (await import(
    moduleUrl
  )) as typeof import('./cinejoy.js')
  const originalFetch = globalThis.fetch
  const masterUrl = 'https://media.example/lisbon/master.m3u8'

  globalThis.fetch = async input => {
    const url = String(input)

    if (url === 'https://api.shegu.st/servers') {
      return new Response('Not found', { status: 404 })
    }
    if (url === 'https://api.shegu.st/crush.wasm') {
      return new Response('Not found', { status: 404 })
    }
    if (url.startsWith('https://cinejoy.to/watch/movie/1081003')) {
      return new Response(
        '<link rel="modulepreload" href="/_app/immutable/entry/app.lisbon.js">'
      )
    }
    if (url === 'https://cinejoy.to/_app/immutable/entry/app.lisbon.js') {
      return new Response(
        'const m=["../nodes/9.lisbon.js"];const r={"/watch/movie/[id]":[9]};'
      )
    }
    if (url === 'https://cinejoy.to/_app/immutable/nodes/9.lisbon.js') {
      return new Response('import{s as y}from"../chunks/gateway-lisbon.js";')
    }
    if (url === 'https://cinejoy.to/_app/immutable/chunks/gateway-lisbon.js') {
      return new Response(
        `import{a as Store}from"./settings.js";const servers=async()=>[{name:"Lisbon"}];const movie=async()=>({stream:[{type:"hls",playlist:"${masterUrl}"}]});const tv=async()=>({stream:[]});export{servers as d,movie as n,tv as o};`
      )
    }
    if (url === masterUrl) {
      return new Response(
        '#EXTM3U\n' +
          '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="en",NAME="English",DEFAULT=YES,URI="audio/en.m3u8"\n' +
          '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,AUDIO="audio"\n' +
          'video/720.m3u8\n' +
          '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,AUDIO="audio"\n' +
          'video/1080.m3u8\n'
      )
    }
    return new Response('Not found', { status: 404 })
  }

  try {
    const links = await cinejoyProvider.streamMovie('1081003')
    assert.deepEqual(
      links.map(link => ({
        url: link.url,
        quality: link.quality,
        hlsVariant: link.hlsVariant,
        audioGroup: link.sizeHlsAudioGroup,
      })),
      [
        {
          url: masterUrl,
          quality: '1080p',
          hlsVariant: 'https://media.example/lisbon/video/1080.m3u8',
          audioGroup: 'audio',
        },
        {
          url: masterUrl,
          quality: '720p',
          hlsVariant: 'https://media.example/lisbon/video/720.m3u8',
          audioGroup: 'audio',
        },
      ]
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('uses the advertised server order and stops after the first stream', async () => {
  const moduleUrl = './cinejoy.js?server-order'
  const { cinejoyProvider } = (await import(
    moduleUrl
  )) as typeof import('./cinejoy.js')
  const originalFetch = globalThis.fetch
  const attemptedServers: string[] = []

  globalThis.fetch = async input => {
    const url = String(input)
    if (url === 'https://api.shegu.st/servers') {
      return new Response(
        JSON.stringify({
          servers: [
            { name: 'Joy' },
            { name: 'Canaias' },
            { name: 'Lisbon' },
            { name: 'Nebula' },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }
    if (url === 'https://api.shegu.st/crush.wasm') {
      return new Response('Not found', { status: 404 })
    }
    if (url.startsWith('https://cinejoy.to/watch/movie/1081003')) {
      return new Response(
        '<link rel="modulepreload" href="/_app/immutable/entry/app.order.js">'
      )
    }
    if (url === 'https://cinejoy.to/_app/immutable/entry/app.order.js') {
      return new Response(
        'const m=["../nodes/8.order.js"];const r={"/watch/movie/[id]":[8]};'
      )
    }
    if (url === 'https://cinejoy.to/_app/immutable/nodes/8.order.js') {
      return new Response('import{s as y}from"../chunks/gateway-order.js";')
    }
    if (url === 'https://cinejoy.to/_app/immutable/chunks/gateway-order.js') {
      return new Response(
        'import{a as Store}from"./settings.js";const servers=async()=>[];const movie=async server=>{await fetch("https://trace/"+server);return server==="Lisbon"?{stream:[{type:"file",url:"https://cdn.example/lisbon.mp4",id:"1080p"}]}:{stream:[]}};const tv=async()=>({stream:[]});export{servers as d,movie as n,tv as o};'
      )
    }
    if (url.startsWith('https://trace/')) {
      attemptedServers.push(url.slice('https://trace/'.length))
      return new Response('ok')
    }
    return new Response('Not found', { status: 404 })
  }

  try {
    const links = await cinejoyProvider.streamMovie('1081003')
    assert.equal(links.length, 1)
    assert.equal(links[0].server, 'Cinejoy | Lisbon | 1080p')
    assert.deepEqual(attemptedServers, ['Lisbon'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('full mode exhausts every advertised Cinejoy server', async () => {
  const moduleUrl = './cinejoy.js?full-server-order'
  const { cinejoyProvider } = (await import(
    moduleUrl
  )) as typeof import('./cinejoy.js')
  const originalFetch = globalThis.fetch
  const attemptedServers: string[] = []

  globalThis.fetch = async input => {
    const url = String(input)
    if (url === 'https://api.shegu.st/servers') {
      return Response.json({
        servers: [
          { name: 'Joy' },
          { name: 'Canaias' },
          { name: 'Lisbon' },
          { name: 'Nebula' },
        ],
      })
    }
    if (url === 'https://api.shegu.st/crush.wasm') {
      return new Response('Not found', { status: 404 })
    }
    if (url.startsWith('https://cinejoy.to/watch/movie/1081003')) {
      return new Response(
        '<link rel="modulepreload" href="/_app/immutable/entry/app.full.js">'
      )
    }
    if (url === 'https://cinejoy.to/_app/immutable/entry/app.full.js') {
      return new Response(
        'const m=["../nodes/10.full.js"];const r={"/watch/movie/[id]":[10]};'
      )
    }
    if (url === 'https://cinejoy.to/_app/immutable/nodes/10.full.js') {
      return new Response('import{s as y}from"../chunks/gateway-full.js";')
    }
    if (url === 'https://cinejoy.to/_app/immutable/chunks/gateway-full.js') {
      return new Response(
        'import{a as Store}from"./settings.js";const servers=async()=>[];const movie=async server=>{await fetch("https://trace/"+server);return {stream:[{type:"file",url:"https://cdn.example/"+server+".mp4",id:"1080p"}]}};const tv=async()=>({stream:[]});export{servers as d,movie as n,tv as o};'
      )
    }
    if (url.startsWith('https://trace/')) {
      attemptedServers.push(url.slice('https://trace/'.length))
      return new Response('ok')
    }
    return new Response('Not found', { status: 404 })
  }

  try {
    const links = await cinejoyProvider.streamMovie('1081003', { full: true })
    assert.deepEqual(attemptedServers, ['Lisbon', 'Canaias', 'Nebula', 'Joy'])
    assert.equal(links.length, 4)
  } finally {
    globalThis.fetch = originalFetch
  }
})
