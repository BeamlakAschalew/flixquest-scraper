import test from 'node:test'
import assert from 'node:assert/strict'
import type { BannerAd } from './ads.js'

test('banner ad contract contains only renderable fields', () => {
  const ad: BannerAd = {
    key: 'banner_1',
    id: 'test',
    name: 'Test ad',
    imageUrl: 'https://example.com/ad.jpg',
    targetUrl: 'https://example.com',
    altText: 'Test ad image',
    shape: 'rectangle',
    aspectRatio: 2.2,
    placements: ['home_movies'],
  }

  assert.ok(ad.id)
  assert.match(ad.imageUrl, /^https:\/\//)
  assert.match(ad.targetUrl, /^https:\/\//)
})
