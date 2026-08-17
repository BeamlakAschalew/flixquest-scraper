import assert from 'node:assert/strict'
import test from 'node:test'
import { extractScriptUrls, webpackChunkIds } from './vidfast-player-updater.mjs'

test('extractScriptUrls keeps only same-origin Next.js JavaScript', () => {
  const html = `
    <script src="/_next/static/chunks/365-hash.js"></script>
    <script src="https://vidfast.vc/_next/static/chunks/771-hash.js?x=1&amp;y=2"></script>
    <script src="https://example.com/_next/static/chunks/255-hash.js"></script>
    <script src="/script.js"></script>
  `
  assert.deepEqual(extractScriptUrls(html, 'https://vidfast.vc'), [
    'https://vidfast.vc/_next/static/chunks/365-hash.js',
    'https://vidfast.vc/_next/static/chunks/771-hash.js?x=1&y=2',
  ])
})

test('webpackChunkIds reads numeric IDs from a Next.js chunk', () => {
  assert.deepEqual(
    webpackChunkIds('(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[268,771],{}])'),
    ['268', '771'],
  )
  assert.deepEqual(webpackChunkIds('console.log("not a webpack chunk")'), [])
})
