import assert from 'node:assert/strict'
import test from 'node:test'
import { buildProviderCacheKey } from './redis.js'

test('full provider responses use a separate cache key', () => {
  const base = {
    providerId: 'cinejoy',
    mediaType: 'movie' as const,
    tmdbId: '550',
  }

  assert.equal(
    buildProviderCacheKey(base),
    'flixquest:provider:cinejoy:movie:550'
  )
  assert.equal(
    buildProviderCacheKey({ ...base, full: true }),
    'flixquest:provider:cinejoy:movie:550:full=true'
  )
})
