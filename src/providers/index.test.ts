import assert from 'node:assert/strict'
import test from 'node:test'
import { getAllProviderIds, getProvider } from './index.js'

test('the enabled shortlist restores StreamFlix and uses Movix for English audio', () => {
  const enabled = getAllProviderIds()

  assert.ok(enabled.includes('streamflix'))
  assert.ok(enabled.includes('movix'))
  assert.ok(!enabled.includes('castle'))
  assert.ok(!enabled.includes('purstream'))
  assert.ok(!enabled.includes('cineby'))
  assert.ok(!enabled.includes('aether'))
  assert.ok(!enabled.includes('vidnest'))
  assert.ok(!enabled.includes('vidrock'))
  assert.ok(getProvider('streamflix'))
  assert.ok(getProvider('movix'))
  assert.equal(getProvider('castle'), undefined)
  assert.equal(getProvider('purstream'), undefined)
  assert.equal(getProvider('cineby'), undefined)
  assert.equal(getProvider('aether'), undefined)
  assert.equal(getProvider('vidnest'), undefined)
  assert.equal(getProvider('vidrock'), undefined)
})
