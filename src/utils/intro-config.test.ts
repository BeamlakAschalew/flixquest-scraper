import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveIntroConfig } from './intro-config.js'

test('intro is disabled when no URL is configured', () => {
  assert.deepEqual(resolveIntroConfig({}), { enabled: false, url: null })
})

test('intro is enabled when a valid URL is configured', () => {
  assert.deepEqual(
    resolveIntroConfig({
      INTRO_VIDEO_URL: 'https://cdn.example.com/intro.mp4',
    }),
    {
      enabled: true,
      url: 'https://cdn.example.com/intro.mp4',
    }
  )
})

test('explicit disable takes precedence over the URL', () => {
  assert.deepEqual(
    resolveIntroConfig({
      INTRO_VIDEO_ENABLED: 'false',
      INTRO_VIDEO_URL: 'https://cdn.example.com/intro.mp4',
    }),
    { enabled: false, url: null }
  )
})

test('enabled intro requires an HTTP URL', () => {
  assert.throws(
    () =>
      resolveIntroConfig({
        INTRO_VIDEO_ENABLED: 'true',
        INTRO_VIDEO_URL: 'file:///tmp/intro.mp4',
      }),
    /HTTP or HTTPS/
  )
})
