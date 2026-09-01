import assert from 'node:assert/strict'
import test from 'node:test'
import { getAllProviderIds, getProvider } from './index.js'

test('the enabled shortlist replaces unavailable StreamFlix and VidRock', () => {
  const enabled = getAllProviderIds()

  assert.ok(enabled.includes('castle'))
  assert.ok(enabled.includes('purstream'))
  assert.ok(!enabled.includes('streamflix'))
  assert.ok(!enabled.includes('vidrock'))
  assert.ok(getProvider('castle'))
  assert.ok(getProvider('purstream'))
  assert.equal(getProvider('streamflix'), undefined)
  assert.equal(getProvider('vidrock'), undefined)
})
