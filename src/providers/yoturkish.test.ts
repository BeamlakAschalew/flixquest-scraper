import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeYoTurkishPlayerData } from './yoturkish.js'

test('decodes YoTurkish chunked player data', () => {
  const encoded =
    'bhQqV|yE1FBxwWW8WW|D0IYioOQGQ|HKAVUPQspV1|N5Wx9vEit|fBz8OTzke|bRZje|WBPNxM/YRE|4EF4qEW0WN|jo0DQ|okH2VicBUMfQ|wsVUU8F1I|1CCZaIClO|HHIePUw|fQ0kKO|R1AGFF4Ww|1rTXpMCzY|UYkRPbxtj|a1wfb|wdBXAwmS|2I/ED9aDG8|='
  assert.equal(
    decodeYoTurkishPlayerData(encoded),
    '<iframe width="100%" height="100%" src="https://rufiiguta.com/?v=3SRuR0Ic_" frameborder="0" scrolling="0" allowfullscreen=""></iframe>'
  )
})
