import type { SubtitleOutputFormat } from './types.js'

/**
 * Timestamp of an SRT (`00:01:39,892`) or WebVTT (`00:01:39.892`) cue.
 * Hours are optional and some uploads use negative offsets.
 */
const TIMING_LINE =
  /^\s*(-?(?:\d{1,3}:)?\d{1,2}:\d{1,2}[.,]\d{1,3})\s*-->\s*(-?(?:\d{1,3}:)?\d{1,2}:\d{1,2}[.,]\d{1,3})/

/**
 * Promotional cues injected by subtitle aggregators. Matched against cue text
 * stripped of every non-alphanumeric character, so punctuation and casing
 * variants ("Open-SUBTITLES", "www.OpenSubtitles.org") collapse to one form.
 */
const AD_FINGERPRINTS = [
  'opensubtitles',
  'osdblink',
  'yifysubtitles',
  'subsceneco',
  'addic7ed',
  'becomevipmember',
  'freebrowserextension',
  'advertiseyourproduct',
  'removeallads',
]

/**
 * Legacy code page names reported by subtitle aggregators mapped onto the
 * WHATWG encoding labels `TextDecoder` accepts.
 */
const ENCODING_ALIASES: Record<string, string> = {
  ascii: 'utf-8',
  'us-ascii': 'utf-8',
  utf8: 'utf-8',
  'utf-8': 'utf-8',
  cp1250: 'windows-1250',
  cp1251: 'windows-1251',
  cp1252: 'windows-1252',
  cp1253: 'windows-1253',
  cp1254: 'windows-1254',
  cp1255: 'windows-1255',
  cp1256: 'windows-1256',
  cp1257: 'windows-1257',
  cp1258: 'windows-1258',
  cp866: 'ibm866',
  cp932: 'shift_jis',
  cp936: 'gbk',
  cp949: 'euc-kr',
  cp950: 'big5',
  gb2312: 'gbk',
  gb18030: 'gb18030',
  gbk: 'gbk',
  big5: 'big5',
  'euc-kr': 'euc-kr',
  'euc-jp': 'euc-jp',
  'shift-jis': 'shift_jis',
  shift_jis: 'shift_jis',
  'koi8-r': 'koi8-r',
  'koi8-u': 'koi8-u',
}

/**
 * Fallback code page per subtitle language, used when the bytes are not valid
 * UTF-8 and the source gave us no encoding hint.
 */
const LANGUAGE_FALLBACK_ENCODING: Record<string, string> = {
  ar: 'windows-1256',
  fa: 'windows-1256',
  ur: 'windows-1256',
  he: 'windows-1255',
  iw: 'windows-1255',
  el: 'windows-1253',
  tr: 'windows-1254',
  ru: 'windows-1251',
  uk: 'windows-1251',
  bg: 'windows-1251',
  sr: 'windows-1251',
  mk: 'windows-1251',
  be: 'windows-1251',
  th: 'windows-874',
  vi: 'windows-1258',
  zh: 'gb18030',
  'zh-cn': 'gb18030',
  'zh-tw': 'big5',
  ja: 'shift_jis',
  ko: 'euc-kr',
  pl: 'windows-1250',
  cs: 'windows-1250',
  sk: 'windows-1250',
  hu: 'windows-1250',
  ro: 'windows-1250',
  hr: 'windows-1250',
  sl: 'windows-1250',
  sq: 'windows-1250',
  lt: 'windows-1257',
  lv: 'windows-1257',
  et: 'windows-1257',
}

export interface SubtitleCue {
  /** Cue start offset in milliseconds. */
  startMs: number
  /** Cue end offset in milliseconds. */
  endMs: number
  text: string
}

function normalizeEncodingLabel(value: string | undefined): string | undefined {
  if (!value) return undefined
  const key = value.trim().toLowerCase()
  if (!key) return undefined
  return ENCODING_ALIASES[key] || key
}

function tryDecode(bytes: Uint8Array, label: string): string | undefined {
  try {
    return new TextDecoder(label, { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

/**
 * Decode raw subtitle bytes to text.
 *
 * Aggregators serve subtitle files as opaque bytes in whatever encoding the
 * original uploader used, so this prefers UTF-8 and falls back to the reported
 * code page, then the language's usual legacy code page, then windows-1252.
 *
 * @param bytes        Raw file contents
 * @param encodingHint Encoding reported by the source, if any
 * @param languageHint ISO 639 code of the subtitle, if known
 */
export function decodeSubtitleBytes(
  bytes: Uint8Array,
  encodingHint?: string,
  languageHint?: string
): string {
  const candidates = [
    'utf-8',
    normalizeEncodingLabel(encodingHint),
    LANGUAGE_FALLBACK_ENCODING[
      (languageHint || '').trim().toLowerCase()
    ] as string,
  ].filter((label): label is string => Boolean(label))

  for (const label of candidates) {
    const decoded = tryDecode(bytes, label)
    if (decoded !== undefined) return stripBom(decoded)
  }

  // windows-1252 maps every byte, so this always yields text.
  return stripBom(new TextDecoder('windows-1252').decode(bytes))
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value
}

function parseTimestamp(value: string): number {
  const negative = value.trim().startsWith('-')
  const parts = value.trim().replace(/^-/, '').split(':')
  const seconds = parts.pop() || '0'
  const [wholeSeconds, fraction = ''] = seconds.split(/[.,]/)

  let total =
    Number(wholeSeconds) * 1000 + Number(fraction.padEnd(3, '0').slice(0, 3))
  if (parts.length) total += Number(parts.pop()) * 60_000
  if (parts.length) total += Number(parts.pop()) * 3_600_000

  if (!Number.isFinite(total)) return 0
  return negative ? -total : total
}

function isAdvertisement(text: string): boolean {
  const fingerprint = text.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!fingerprint) return true
  return AD_FINGERPRINTS.some(pattern => fingerprint.includes(pattern))
}

function sanitizeCueText(text: string): string {
  return (
    text
      // SSA/ASS override blocks such as {\an8} leak through as literal text.
      .replace(/\{\\[^}]*\}/g, '')
      // <font> is not part of WebVTT and renders as literal text in some players.
      .replace(/<\/?font[^>]*>/gi, '')
      .split('\n')
      .map(line => line.trimEnd())
      .join('\n')
      .replace(/^\n+|\n+$/g, '')
  )
}

/**
 * Parse SRT or WebVTT text into cues, dropping promotional and unusable cues.
 *
 * Cues are located by scanning for timing lines rather than by splitting on
 * blank lines, so cue text containing blank lines survives intact.
 */
export function parseSubtitleCues(source: string): SubtitleCue[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const cues: SubtitleCue[] = []

  let startMs = 0
  let endMs = 0
  let buffer: string[] | undefined

  const flush = () => {
    if (!buffer) return
    // A trailing bare number is the next cue's SRT index, not cue text.
    while (buffer.length && !buffer[buffer.length - 1].trim()) buffer.pop()
    if (buffer.length && /^\d+$/.test(buffer[buffer.length - 1].trim())) {
      buffer.pop()
    }

    const text = sanitizeCueText(buffer.join('\n'))
    buffer = undefined

    const start = Math.max(0, startMs)
    const end = Math.max(0, endMs)
    if (!text || end <= start || isAdvertisement(text)) return

    cues.push({ startMs: start, endMs: end, text })
  }

  for (const line of lines) {
    const timing = TIMING_LINE.exec(line)
    if (timing) {
      flush()
      startMs = parseTimestamp(timing[1])
      endMs = parseTimestamp(timing[2])
      buffer = []
      continue
    }
    // Lines before the first timing line are the WEBVTT header or a cue index.
    if (buffer) buffer.push(line)
  }
  flush()

  return cues
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

function formatTimestamp(totalMs: number, msSeparator: '.' | ','): string {
  const ms = Math.max(0, Math.round(totalMs))
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${msSeparator}${pad(
    ms % 1000,
    3
  )}`
}

/** Serialize cues as a WebVTT document. */
export function toWebVtt(cues: SubtitleCue[]): string {
  const blocks = cues.map(
    (cue, index) =>
      `${index + 1}\n${formatTimestamp(cue.startMs, '.')} --> ${formatTimestamp(
        cue.endMs,
        '.'
      )}\n${cue.text}`
  )

  return `WEBVTT\n\n${blocks.join('\n\n')}\n`
}

/** Serialize cues as an SRT document. */
export function toSrt(cues: SubtitleCue[]): string {
  const blocks = cues.map(
    (cue, index) =>
      `${index + 1}\n${formatTimestamp(cue.startMs, ',')} --> ${formatTimestamp(
        cue.endMs,
        ','
      )}\n${cue.text}`
  )

  return `${blocks.join('\n\n')}\n`
}

/**
 * Normalize a raw subtitle file into the requested wire format, stripping
 * aggregator advertisements and repairing malformed timings along the way.
 */
export function convertSubtitle(
  source: string,
  format: SubtitleOutputFormat
): string {
  const cues = parseSubtitleCues(source)
  if (cues.length === 0) {
    throw new Error('Subtitle file contained no usable cues')
  }

  return format === 'vtt' ? toWebVtt(cues) : toSrt(cues)
}
