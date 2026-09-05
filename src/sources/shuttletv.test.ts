import assert from 'node:assert/strict'
import test from 'node:test'
import { buildShuttleTvEmbedUrl } from './shuttletv.js'

test('pins ShuttleTV movie resolution to the Lisbon Cinesrc server', () => {
  assert.equal(
    buildShuttleTvEmbedUrl('movie', '550'),
    'https://cinesrc.st/embed/movie/550?prioritize=true&lastserver=lisbon'
  )
})

test('includes season and episode for TV resolution', () => {
  assert.equal(
    buildShuttleTvEmbedUrl('tv', '1399', 2, 3),
    'https://cinesrc.st/embed/tv/1399?prioritize=true&lastserver=lisbon&s=2&e=3'
  )
})

test('rejects malformed IDs and incomplete TV requests', () => {
  assert.throws(() => buildShuttleTvEmbedUrl('movie', 'abc'), /Invalid TMDB ID/)
  assert.throws(
    () => buildShuttleTvEmbedUrl('tv', '1399', 0, 1),
    /positive integer season and episode/
  )
})
