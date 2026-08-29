import assert from 'node:assert/strict'
import test from 'node:test'
import {
  convertSubtitle,
  decodeSubtitleBytes,
  parseSubtitleCues,
} from './vtt.js'

const SAMPLE_SRT = [
  '1',
  '00:00:06,000 --> 00:00:12,074',
  'Support us and become VIP member',
  'to remove all ads from www.OpenSubtitles.org',
  '',
  '2',
  '00:01:39,892 --> 00:01:41,852',
  'Stop. Stop.',
  '',
  '3',
  '00:01:41,935 --> 00:01:43,395',
  'Gary, what the fuck?',
  '',
].join('\r\n')

test('converts SRT to WebVTT and drops aggregator ads', () => {
  const vtt = convertSubtitle(SAMPLE_SRT, 'vtt')

  assert.ok(vtt.startsWith('WEBVTT\n\n'))
  assert.ok(vtt.includes('00:01:39.892 --> 00:01:41.852'))
  assert.ok(!vtt.includes('OpenSubtitles'))
  assert.equal(vtt.match(/-->/g)?.length, 2)
})

test('renumbers cues after dropping ads', () => {
  const vtt = convertSubtitle(SAMPLE_SRT, 'vtt')
  const identifiers = vtt
    .split('\n\n')
    .slice(1)
    .map(block => block.split('\n')[0])
    .filter(Boolean)

  assert.deepEqual(identifiers, ['1', '2'])
})

test('round-trips back to SRT with comma separators', () => {
  const srt = convertSubtitle(SAMPLE_SRT, 'srt')

  assert.ok(!srt.startsWith('WEBVTT'))
  assert.ok(srt.includes('00:01:39,892 --> 00:01:41,852'))
})

test('clamps negative offsets and drops empty ranges', () => {
  const cues = parseSubtitleCues(
    [
      '1',
      '-00:00:07,000 --> 00:00:00,000',
      '[no audio]',
      '',
      '2',
      '-00:00:02,000 --> 00:00:03,000',
      'Clamped start.',
    ].join('\n')
  )

  assert.equal(cues.length, 1)
  assert.equal(cues[0].startMs, 0)
  assert.equal(cues[0].endMs, 3000)
})

test('accepts hour-less timestamps', () => {
  const cues = parseSubtitleCues(
    ['1', '01:39,892 --> 01:41,852', 'Hi'].join('\n')
  )

  assert.equal(cues.length, 1)
  assert.equal(cues[0].startMs, 99_892)
})

test('keeps cue text containing blank lines together', () => {
  const cues = parseSubtitleCues(
    [
      '1',
      '00:00:01,000 --> 00:00:02,000',
      'First',
      '',
      'Second',
      '',
      '2',
      '00:00:03,000 --> 00:00:04,000',
      'Next',
    ].join('\n')
  )

  assert.equal(cues.length, 2)
  assert.equal(cues[0].text, 'First\n\nSecond')
  assert.equal(cues[1].text, 'Next')
})

test('parses an existing WebVTT document', () => {
  const vtt = convertSubtitle(
    ['WEBVTT', '', '1', '00:00:01.000 --> 00:00:02.000', 'Already VTT'].join(
      '\n'
    ),
    'vtt'
  )

  assert.ok(vtt.includes('00:00:01.000 --> 00:00:02.000'))
  assert.equal(vtt.match(/WEBVTT/g)?.length, 1)
})

test('strips SSA override tags and font markup', () => {
  const cues = parseSubtitleCues(
    [
      '1',
      '00:00:01,000 --> 00:00:02,000',
      '{\\an8}<font color="#ffffff"><i>Tilted</i></font>',
    ].join('\n')
  )

  assert.equal(cues[0].text, '<i>Tilted</i>')
})

test('throws when a file has no usable cues', () => {
  assert.throws(() => convertSubtitle('error code: 502', 'vtt'))
})

test('decodes UTF-8 and falls back to a language code page', () => {
  const utf8 = decodeSubtitleBytes(
    new Uint8Array(Buffer.from('﻿Arrêt!', 'utf8'))
  )
  assert.equal(utf8, 'Arrêt!')

  // 0xC0 is invalid UTF-8 but maps to 'А' in windows-1251.
  const cyrillic = decodeSubtitleBytes(new Uint8Array([0xc0]), undefined, 'ru')
  assert.equal(cyrillic, 'А')
})
