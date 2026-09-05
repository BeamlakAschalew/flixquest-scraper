import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildProviderCases,
  checkProvider,
  mapLimit,
} from './provider-health-monitor.mjs'

test('uses Hollywood plus a provider affinity title list', () => {
  const cases = buildProviderCases('kisskh')
  assert.equal(cases.length, 8)
  assert.deepEqual([...new Set(cases.map(item => item.category))], [
    'hollywood',
    'korean',
  ])
})

test('uses the Turkish title list for YoTurkish', () => {
  const cases = buildProviderCases('yoturkish')
  assert.equal(cases.length, 9)
  assert.deepEqual([...new Set(cases.map(item => item.category))], [
    'hollywood',
    'turkish',
  ])
  assert.deepEqual(cases.filter(item => item.category === 'turkish').map(item => item.title), [
    'Miracle in Cell No. 7 (Turkish)',
    'Recep Ivedik',
    'Yali Capkini S1E1',
    'Dirilis: Ertugrul S1E1',
    'The Protector S1E1',
  ])
})

test('tries another title after failure and stops at the first stream', async () => {
  const requests = []
  const fetchFn = async url => {
    requests.push(url)
    if (requests.length === 2) {
      return new Response(
        JSON.stringify({ success: true, links: [{ url: 'stream' }] }),
        { status: 200 }
      )
    }
    return new Response(JSON.stringify({ success: false, error: 'No streams' }), {
      status: 404,
    })
  }
  const result = await checkProvider('http://api.test', 'cineby', {
    alias: 'Cineby Alias',
    timeoutMs: 1_000,
    fetchFn,
  })
  assert.equal(result.status, 'online')
  assert.equal(result.testedTitles, 2)
  assert.equal(result.successfulTitle.title, 'Oppenheimer')
  assert.equal(result.alias, 'Cineby Alias')
  assert.equal(typeof result.requestTimeMs, 'number')
  assert.equal(requests.length, 2)
})

test('exhausts every available title before marking a provider offline', async () => {
  let requestCount = 0
  const fetchFn = async () => {
    requestCount += 1
    return new Response(JSON.stringify({ success: false, error: 'No streams' }), {
      status: 404,
    })
  }
  const result = await checkProvider('http://api.test', 'cineby', {
    timeoutMs: 1_000,
    fetchFn,
  })
  assert.equal(result.status, 'offline')
  assert.equal(result.testedTitles, 4)
  assert.equal(requestCount, 4)
})

test('limits concurrent provider work', async () => {
  let active = 0
  let maximum = 0
  await mapLimit([1, 2, 3, 4, 5], 2, async value => {
    active += 1
    maximum = Math.max(maximum, active)
    await new Promise(resolve => setTimeout(resolve, 10))
    active -= 1
    return value * 2
  })
  assert.equal(maximum, 2)
})
