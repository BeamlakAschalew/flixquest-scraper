import { createHmac, timingSafeEqual } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { ProviderLink } from '../types/index.js'
import {
  forwardProxyStorage,
  mustUseForwardProxyUrl,
  type ForwardProxyContext,
} from './forward-proxy.js'

const TOKEN_TTL_MS = 30 * 60 * 1000
const ESTIMATE_TIMEOUT_MS = 5_000
const REQUEST_TIMEOUT_MS = 3_500
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024
const MP4_CONTAINER_ALLOWANCE = 1.01
const ASSUMED_EXTERNAL_AUDIO_BITRATE = 128_000
const SAMPLE_POSITIONS = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95]
const MIN_SUCCESSFUL_SAMPLES = 3
const estimateAbortStorage = new AsyncLocalStorage<AbortSignal>()

export interface StreamSizeTokenPayload {
  url: string
  headers: Record<string, string>
  expires: number
  isM3U8: boolean
  isDASH: boolean
  maxVideoHeight?: number
  selectedVariantUrl?: string
  audioGroup?: string
  hlsAudioLanguage?: string
  forwardProxy?: ForwardProxyContext
}

export interface StreamSizeResult {
  estimatedBytes: number | null
  confidence: 'high' | 'medium' | 'low' | 'unknown'
  method:
    | 'hls-average-bandwidth'
    | 'hls-bandwidth'
    | 'hls-segment-bitrate'
    | 'hls-segment-sample'
    | 'resolution-fallback'
    | 'dash-bandwidth'
    | 'content-length'
    | 'unavailable'
  format: 'hls' | 'dash' | 'unknown'
  bitrate: number | null
  videoBytes: number | null
  audioBytes: number | null
  initBytes: number
  segmentCount: number
  durationSeconds: number | null
  sampledSegments?: number
  successfulSamples?: number
  sampledDurationSeconds?: number
  error?: string
}

interface HlsVariant {
  url: string
  height: number
  bandwidth: number
  averageBandwidth: number
  audioGroup?: string
}

interface HlsSegment {
  url: string
  durationSeconds: number
  knownLength?: number
}

interface HlsMediaStats {
  durationSeconds: number
  segmentCount: number
  weightedSegmentBitrate: number | null
  segments: HlsSegment[]
}

interface HlsAudioRendition {
  url: string
  group: string
  language?: string
  isDefault: boolean
  autoselect: boolean
}

interface SampleEstimate {
  estimatedBytes: number | null
  bitrate: number | null
  sampledSegments: number
  successfulSamples: number
  sampledDurationSeconds: number
}

function signingSecret(): string {
  const secret =
    process.env.STREAM_PROXY_SECRET?.trim() || process.env.TMDB_API_KEY?.trim()
  if (!secret) throw new Error('STREAM_PROXY_SECRET is not configured')
  return secret
}

function sign(value: string): string {
  return createHmac('sha256', signingSecret()).update(value).digest('base64url')
}

function encodePayload(payload: StreamSizeTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${sign(encoded)}`
}

function decodePayload(token: string): StreamSizeTokenPayload {
  const [encoded, signature, ...extra] = token.split('.')
  if (!encoded || !signature || extra.length > 0) {
    throw new Error('Malformed size token')
  }
  const expected = Buffer.from(sign(encoded))
  const received = Buffer.from(signature)
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    throw new Error('Invalid size token')
  }

  const payload = JSON.parse(
    Buffer.from(encoded, 'base64url').toString('utf8')
  ) as StreamSizeTokenPayload
  if (
    !payload ||
    typeof payload.url !== 'string' ||
    typeof payload.expires !== 'number' ||
    payload.expires < Date.now() ||
    !payload.headers ||
    typeof payload.headers !== 'object' ||
    typeof payload.isM3U8 !== 'boolean' ||
    typeof payload.isDASH !== 'boolean' ||
    (payload.maxVideoHeight !== undefined &&
      (!Number.isSafeInteger(payload.maxVideoHeight) ||
        payload.maxVideoHeight <= 0)) ||
    (payload.selectedVariantUrl !== undefined &&
      typeof payload.selectedVariantUrl !== 'string') ||
    (payload.audioGroup !== undefined &&
      typeof payload.audioGroup !== 'string') ||
    (payload.hlsAudioLanguage !== undefined &&
      typeof payload.hlsAudioLanguage !== 'string')
  ) {
    throw new Error('Expired or invalid size token')
  }
  return payload
}

export function createStreamSizeToken(link: ProviderLink): string {
  const forwardProxy = forwardProxyStorage.getStore()
  const qualityHeight = Number(
    link.quality.match(/(?:^|\D)(\d{3,4})p?(?:\D|$)/i)?.[1]
  )
  return encodePayload({
    url: link.sizeManifestUrl || link.url,
    headers: link.headers || {},
    expires: Date.now() + TOKEN_TTL_MS,
    isM3U8: link.isM3U8,
    isDASH: link.isDASH === true,
    maxVideoHeight:
      link.dashVideoHeight ||
      (Number.isSafeInteger(qualityHeight) && qualityHeight > 0
        ? qualityHeight
        : undefined),
    selectedVariantUrl: link.sizeHlsVariantUrl,
    audioGroup: link.sizeHlsAudioGroup,
    hlsAudioLanguage: link.hlsAudioLanguage,
    forwardProxy: forwardProxy?.fProxyEnabled ? forwardProxy : undefined,
  })
}

function privateAddress(address: string): boolean {
  if (
    address === '::1' ||
    address === '::' ||
    address.startsWith('fc') ||
    address.startsWith('fd') ||
    address.startsWith('fe80:')
  ) {
    return true
  }
  if (address.startsWith('::ffff:')) return privateAddress(address.slice(7))
  const parts = address.split('.').map(Number)
  return (
    parts.length === 4 &&
    parts.every(Number.isInteger) &&
    (parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] === 0)
  )
}

async function safeUrl(value: string): Promise<URL> {
  const url = new URL(value)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error('Unsupported size destination')
  }
  if (isIP(url.hostname)) {
    if (privateAddress(url.hostname))
      throw new Error('Private size destination')
  } else {
    const addresses = await lookup(url.hostname, { all: true })
    if (
      addresses.length === 0 ||
      addresses.some(item => privateAddress(item.address))
    ) {
      throw new Error('Private size destination')
    }
  }
  return url
}

function requestHeaders(
  payload: StreamSizeTokenPayload,
  url: URL
): Record<string, string> {
  const headers: Record<string, string> = { ...payload.headers, Accept: '*/*' }
  if (!mustUseForwardProxyUrl(url.href)) {
    headers['x-skip-forward-proxy'] = 'true'
  }
  return headers
}

async function request(
  url: string,
  payload: StreamSizeTokenPayload,
  init: RequestInit = {}
): Promise<Response> {
  let current = await safeUrl(url)
  for (let redirects = 0; redirects <= 8; redirects++) {
    const controller = new AbortController()
    const parentSignal = estimateAbortStorage.getStore()
    const abortFromParent = () => controller.abort(parentSignal?.reason)
    if (parentSignal?.aborted) abortFromParent()
    else
      parentSignal?.addEventListener('abort', abortFromParent, { once: true })
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(current, {
        ...init,
        redirect: 'manual',
        headers: {
          ...requestHeaders(payload, current),
          ...(init.headers || {}),
        },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
      parentSignal?.removeEventListener('abort', abortFromParent)
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get('location')
    await response.body?.cancel()
    if (!location || redirects === 8) {
      throw new Error('Invalid or excessive size redirects')
    }
    current = await safeUrl(new URL(location, current).href)
  }
  throw new Error('Too many size redirects')
}

async function bodyText(response: Response): Promise<string> {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_MANIFEST_BYTES) {
    throw new Error('Manifest is too large')
  }
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > MAX_MANIFEST_BYTES) {
    throw new Error('Manifest is too large')
  }
  return text
}

function parseAttributes(value: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const match of value.matchAll(
    /([A-Z0-9_:-]+)=("[^"]*"|'[^']*'|[^,\s>]*)/gi
  )) {
    result[match[1].toUpperCase()] = match[2].replace(/^["']|["']$/g, '')
  }
  return result
}

function absolute(value: string, base: string): string {
  return new URL(value, base).href
}

function estimateBytes(bitrate: number, durationSeconds: number): number {
  return Math.round((bitrate * durationSeconds * MP4_CONTAINER_ALLOWANCE) / 8)
}

function hlsVariants(lines: string[], base: string): HlsVariant[] {
  const variants: HlsVariant[] = []
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (!/^#EXT-X-STREAM-INF:/i.test(line)) continue
    const attributes = parseAttributes(line.slice(line.indexOf(':') + 1))
    const uri = lines
      .slice(index + 1)
      .find(item => item && !item.startsWith('#'))
    if (!uri) continue
    variants.push({
      url: absolute(uri, base),
      height: Number(attributes.RESOLUTION?.match(/x(\d+)$/i)?.[1]) || 0,
      bandwidth: Number(attributes.BANDWIDTH) || 0,
      averageBandwidth: Number(attributes['AVERAGE-BANDWIDTH']) || 0,
      audioGroup: attributes.AUDIO,
    })
  }
  return variants
}

function selectHlsVariant(
  variants: HlsVariant[],
  payload: StreamSizeTokenPayload
): HlsVariant {
  const exact = payload.selectedVariantUrl
    ? variants.find(item => item.url === payload.selectedVariantUrl)
    : undefined
  if (exact) return exact
  const eligible = payload.maxVideoHeight
    ? variants.filter(
        item => item.height > 0 && item.height <= payload.maxVideoHeight!
      )
    : variants
  return (eligible.length ? eligible : variants).reduce((best, item) =>
    item.height > best.height ||
    (item.height === best.height && item.bandwidth > best.bandwidth)
      ? item
      : best
  )
}

function hlsMediaStats(lines: string[], base: string): HlsMediaStats {
  let durationSeconds = 0
  let segmentCount = 0
  let pendingDuration = 0
  let pendingBitrate = 0
  let measuredDuration = 0
  let weightedBitrateDuration = 0
  let pendingByteRange: number | undefined
  const segments: HlsSegment[] = []

  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) {
      pendingDuration = Number(line.slice(8).split(',')[0]) || 0
      durationSeconds += pendingDuration
      continue
    }
    if (line.startsWith('#EXT-X-BITRATE:')) {
      pendingBitrate = (Number(line.slice(15)) || 0) * 1_000
      continue
    }
    if (line.startsWith('#EXT-X-BYTERANGE:')) {
      pendingByteRange = Number(line.slice(17).split('@')[0]) || undefined
      continue
    }
    if (!line || line.startsWith('#')) continue
    segmentCount++
    segments.push({
      url: absolute(line, base),
      durationSeconds: pendingDuration,
      knownLength: pendingByteRange,
    })
    if (pendingBitrate > 0 && pendingDuration > 0) {
      measuredDuration += pendingDuration
      weightedBitrateDuration += pendingBitrate * pendingDuration
    }
    pendingDuration = 0
    pendingBitrate = 0
    pendingByteRange = undefined
  }

  return {
    durationSeconds,
    segmentCount,
    weightedSegmentBitrate:
      measuredDuration > 0 ? weightedBitrateDuration / measuredDuration : null,
    segments,
  }
}

function hlsAudioRenditions(
  lines: string[],
  base: string
): HlsAudioRendition[] {
  const renditions: HlsAudioRendition[] = []
  for (const line of lines) {
    if (!/^#EXT-X-MEDIA:/i.test(line)) continue
    const attributes = parseAttributes(line.slice(line.indexOf(':') + 1))
    if (
      attributes.TYPE?.toUpperCase() !== 'AUDIO' ||
      !attributes.URI ||
      !attributes['GROUP-ID']
    ) {
      continue
    }
    renditions.push({
      url: absolute(attributes.URI, base),
      group: attributes['GROUP-ID'],
      language: attributes.LANGUAGE,
      isDefault: attributes.DEFAULT?.toUpperCase() === 'YES',
      autoselect: attributes.AUTOSELECT?.toUpperCase() === 'YES',
    })
  }
  return renditions
}

function selectedAudioRendition(
  renditions: HlsAudioRendition[],
  payload: StreamSizeTokenPayload,
  variant: HlsVariant
): HlsAudioRendition | undefined {
  const group = payload.audioGroup || variant.audioGroup
  const matching = renditions.filter(item => item.group === group)
  return (
    matching.find(
      item =>
        payload.hlsAudioLanguage &&
        item.language?.toLowerCase() === payload.hlsAudioLanguage.toLowerCase()
    ) ||
    matching.find(item => item.isDefault) ||
    matching.find(item => item.autoselect) ||
    matching[0]
  )
}

function sampledSegments(segments: HlsSegment[]): HlsSegment[] {
  if (segments.length <= SAMPLE_POSITIONS.length) return segments
  const indices = new Set(
    SAMPLE_POSITIONS.map(position =>
      Math.round(position * Math.max(segments.length - 1, 0))
    )
  )
  return [...indices].map(index => segments[index])
}

async function probeSegmentLength(
  segment: HlsSegment,
  payload: StreamSizeTokenPayload
): Promise<number | null> {
  if (segment.knownLength !== undefined) return segment.knownLength
  try {
    const response = await request(segment.url, payload, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
    })
    const total = response.headers
      .get('content-range')
      ?.match(/^bytes\s+\d+-\d+\/(\d+)$/i)?.[1]
    await response.body?.cancel()
    const length = Number(total)
    return response.status === 206 && Number.isSafeInteger(length) && length > 0
      ? length
      : null
  } catch {
    return null
  }
}

async function estimateFromSamples(
  stats: HlsMediaStats,
  payload: StreamSizeTokenPayload
): Promise<SampleEstimate> {
  const samples = sampledSegments(stats.segments).filter(
    segment => segment.durationSeconds > 0
  )
  const lengths = await Promise.all(
    samples.map(segment => probeSegmentLength(segment, payload))
  )
  let bytes = 0
  let duration = 0
  let successfulSamples = 0
  for (let index = 0; index < samples.length; index++) {
    const length = lengths[index]
    if (length === null) continue
    bytes += length
    duration += samples[index].durationSeconds
    successfulSamples++
  }
  const bitrate = duration > 0 ? (bytes * 8) / duration : null
  return {
    estimatedBytes:
      bitrate !== null && successfulSamples >= MIN_SUCCESSFUL_SAMPLES
        ? estimateBytes(bitrate, stats.durationSeconds)
        : null,
    bitrate,
    sampledSegments: samples.length,
    successfulSamples,
    sampledDurationSeconds: duration,
  }
}

function resolutionFallbackBitrate(height: number | undefined): number | null {
  if (!height) return null
  if (height >= 2160) return 18_000_000
  if (height >= 1440) return 10_000_000
  if (height >= 1080) return 6_000_000
  if (height >= 720) return 3_000_000
  if (height >= 576) return 2_000_000
  if (height >= 480) return 1_400_000
  if (height >= 360) return 900_000
  if (height >= 240) return 500_000
  return 300_000
}

async function readManifest(
  url: string,
  payload: StreamSizeTokenPayload
): Promise<{ text: string; url: string }> {
  const response = await request(url, payload)
  if (!response.ok) {
    throw new Error(`Manifest request failed (${response.status})`)
  }
  return { text: await bodyText(response), url: response.url || url }
}

async function estimateHls(
  payload: StreamSizeTokenPayload
): Promise<StreamSizeResult> {
  const root = await readManifest(payload.url, payload)
  const rootLines = root.text.split(/\r?\n/).map(line => line.trim())
  const variants = hlsVariants(rootLines, root.url)

  let bitrate = 0
  let method: StreamSizeResult['method'] = 'unavailable'
  let confidence: StreamSizeResult['confidence'] = 'unknown'
  let mediaLines = rootLines
  let mediaBase = root.url
  let selectedVariant: HlsVariant | undefined
  const audioRenditions = hlsAudioRenditions(rootLines, root.url)

  if (variants.length > 0) {
    selectedVariant = selectHlsVariant(variants, payload)
    bitrate = selectedVariant.averageBandwidth || selectedVariant.bandwidth
    method = selectedVariant.averageBandwidth
      ? 'hls-average-bandwidth'
      : 'hls-bandwidth'
    confidence = selectedVariant.averageBandwidth ? 'high' : 'medium'
    const media = await readManifest(selectedVariant.url, payload)
    mediaBase = media.url
    mediaLines = media.text.split(/\r?\n/).map(line => line.trim())
  }

  const stats = hlsMediaStats(mediaLines, mediaBase)
  const hasSeparateAudio =
    selectedVariant !== undefined &&
    selectedAudioRendition(audioRenditions, payload, selectedVariant) !==
      undefined
  if (bitrate <= 0 && stats.weightedSegmentBitrate) {
    bitrate = stats.weightedSegmentBitrate
    method = 'hls-segment-bitrate'
    confidence = 'high'
  }

  if (bitrate <= 0 && stats.durationSeconds > 0 && stats.segments.length > 0) {
    const sampled = await estimateFromSamples(stats, payload)
    if (sampled.bitrate !== null && sampled.estimatedBytes !== null) {
      const audioBitrate = hasSeparateAudio ? ASSUMED_EXTERNAL_AUDIO_BITRATE : 0
      const totalBitrate = sampled.bitrate + audioBitrate
      const videoBytes = estimateBytes(sampled.bitrate, stats.durationSeconds)
      const audioBytes = hasSeparateAudio
        ? estimateBytes(audioBitrate, stats.durationSeconds)
        : null
      return {
        estimatedBytes: estimateBytes(totalBitrate, stats.durationSeconds),
        confidence: 'medium',
        method: 'hls-segment-sample',
        format: 'hls',
        bitrate: totalBitrate,
        videoBytes,
        audioBytes,
        initBytes: 0,
        segmentCount: stats.segmentCount,
        durationSeconds: stats.durationSeconds,
        sampledSegments: sampled.sampledSegments,
        successfulSamples: sampled.successfulSamples,
        sampledDurationSeconds: sampled.sampledDurationSeconds,
      }
    }

    const videoBitrate = resolutionFallbackBitrate(
      payload.maxVideoHeight || selectedVariant?.height
    )
    if (videoBitrate !== null) {
      const audioBitrate = hasSeparateAudio ? ASSUMED_EXTERNAL_AUDIO_BITRATE : 0
      const fallbackBitrate = videoBitrate + audioBitrate
      const videoBytes = estimateBytes(videoBitrate, stats.durationSeconds)
      const audioBytes = hasSeparateAudio
        ? estimateBytes(audioBitrate, stats.durationSeconds)
        : null
      return {
        estimatedBytes: estimateBytes(fallbackBitrate, stats.durationSeconds),
        confidence: 'low',
        method: 'resolution-fallback',
        format: 'hls',
        bitrate: fallbackBitrate,
        videoBytes,
        audioBytes,
        initBytes: 0,
        segmentCount: stats.segmentCount,
        durationSeconds: stats.durationSeconds,
        sampledSegments: sampledSegments(stats.segments).length,
        successfulSamples: sampled.successfulSamples,
        sampledDurationSeconds: sampled.sampledDurationSeconds,
        error:
          'Segment sampling was unavailable; using a resolution-based estimate',
      }
    }
  }

  if (bitrate <= 0 || stats.durationSeconds <= 0) {
    return {
      estimatedBytes: null,
      confidence: 'unknown',
      method: 'unavailable',
      format: 'hls',
      bitrate: bitrate || null,
      videoBytes: null,
      audioBytes: null,
      initBytes: 0,
      segmentCount: stats.segmentCount,
      durationSeconds: stats.durationSeconds || null,
      error: 'The HLS manifests do not declare enough bitrate information',
    }
  }

  const estimatedBytes = estimateBytes(bitrate, stats.durationSeconds)
  return {
    estimatedBytes,
    confidence,
    method,
    format: 'hls',
    bitrate,
    videoBytes: estimatedBytes,
    audioBytes: null,
    initBytes: 0,
    segmentCount: stats.segmentCount,
    durationSeconds: stats.durationSeconds,
  }
}

function isoDurationSeconds(value: string | undefined): number | null {
  const match = value?.match(
    /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i
  )
  if (!match) return null
  return (
    (Number(match[1]) || 0) * 86_400 +
    (Number(match[2]) || 0) * 3_600 +
    (Number(match[3]) || 0) * 60 +
    (Number(match[4]) || 0)
  )
}

function dashRepresentations(text: string): Array<{
  type: 'video' | 'audio' | 'unknown'
  height: number
  bandwidth: number
}> {
  const result: Array<{
    type: 'video' | 'audio' | 'unknown'
    height: number
    bandwidth: number
  }> = []
  for (const setMatch of text.matchAll(
    /<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet>/gi
  )) {
    const set = parseAttributes(setMatch[1])
    const setType =
      `${set.CONTENTTYPE || ''} ${set.MIMETYPE || ''}`.toLowerCase()
    for (const representation of setMatch[2].matchAll(
      /<Representation\b([^>]*)/gi
    )) {
      const attributes = parseAttributes(representation[1])
      const typeValue =
        `${attributes.CONTENTTYPE || ''} ${attributes.MIMETYPE || ''} ${setType}`.toLowerCase()
      result.push({
        type: typeValue.includes('video')
          ? 'video'
          : typeValue.includes('audio')
            ? 'audio'
            : 'unknown',
        height: Number(attributes.HEIGHT) || 0,
        bandwidth: Number(attributes.BANDWIDTH) || 0,
      })
    }
  }
  return result
}

async function estimateDash(
  payload: StreamSizeTokenPayload
): Promise<StreamSizeResult> {
  const manifest = await readManifest(payload.url, payload)
  const mpdAttributes = parseAttributes(
    manifest.text.match(/<MPD\b([^>]*)>/i)?.[1] || ''
  )
  const periodAttributes = parseAttributes(
    manifest.text.match(/<Period\b([^>]*)>/i)?.[1] || ''
  )
  const durationSeconds =
    isoDurationSeconds(mpdAttributes.MEDIAPRESENTATIONDURATION) ||
    isoDurationSeconds(periodAttributes.DURATION)
  const representations = dashRepresentations(manifest.text)
  const videoCandidates = representations.filter(
    item =>
      item.type === 'video' &&
      item.bandwidth > 0 &&
      (!payload.maxVideoHeight ||
        item.height === 0 ||
        item.height <= payload.maxVideoHeight)
  )
  const video = videoCandidates.reduce(
    (best, item) =>
      !best ||
      item.height > best.height ||
      (item.height === best.height && item.bandwidth > best.bandwidth)
        ? item
        : best,
    undefined as (typeof videoCandidates)[number] | undefined
  )
  const audio = representations
    .filter(item => item.type === 'audio' && item.bandwidth > 0)
    .reduce(
      (best, item) => (!best || item.bandwidth > best.bandwidth ? item : best),
      undefined as (typeof representations)[number] | undefined
    )
  const bitrate = (video?.bandwidth || 0) + (audio?.bandwidth || 0)

  if (!durationSeconds || bitrate <= 0) {
    return {
      estimatedBytes: null,
      confidence: 'unknown',
      method: 'unavailable',
      format: 'dash',
      bitrate: bitrate || null,
      videoBytes: null,
      audioBytes: null,
      initBytes: 0,
      segmentCount: 0,
      durationSeconds,
      error:
        'The DASH manifest does not declare duration and representation bandwidth',
    }
  }

  const videoBytes = video
    ? estimateBytes(video.bandwidth, durationSeconds)
    : null
  const audioBytes = audio
    ? estimateBytes(audio.bandwidth, durationSeconds)
    : null
  return {
    estimatedBytes: estimateBytes(bitrate, durationSeconds),
    confidence: 'high',
    method: 'dash-bandwidth',
    format: 'dash',
    bitrate,
    videoBytes,
    audioBytes,
    initBytes: 0,
    segmentCount: 0,
    durationSeconds,
  }
}

async function progressiveLength(
  payload: StreamSizeTokenPayload
): Promise<number | null> {
  for (const init of [
    { method: 'HEAD' },
    { method: 'GET', headers: { Range: 'bytes=0-0' } },
  ]) {
    try {
      const response = await request(payload.url, payload, init)
      const range = response.headers
        .get('content-range')
        ?.match(/\/([0-9]+)$/)?.[1]
      const length = Number(range || response.headers.get('content-length'))
      await response.body?.cancel()
      if (response.ok && Number.isSafeInteger(length) && length >= 0) {
        return length
      }
    } catch {
      // Try the next metadata request.
    }
  }
  return null
}

async function estimate(
  payload: StreamSizeTokenPayload
): Promise<StreamSizeResult> {
  if (payload.isM3U8) return estimateHls(payload)
  if (payload.isDASH) return estimateDash(payload)
  const length = await progressiveLength(payload)
  return {
    estimatedBytes: length,
    confidence: length === null ? 'unknown' : 'high',
    method: length === null ? 'unavailable' : 'content-length',
    format: 'unknown',
    bitrate: null,
    videoBytes: length,
    audioBytes: null,
    initBytes: 0,
    segmentCount: length === null ? 0 : 1,
    durationSeconds: null,
    ...(length === null ? { error: 'Content length is not available' } : {}),
  }
}

export async function estimateStreamSize(
  token: string
): Promise<StreamSizeResult> {
  const payload = decodePayload(token)
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort()
      reject(new Error('Stream size estimate timed out'))
    }, ESTIMATE_TIMEOUT_MS)
  })
  return Promise.race([
    estimateAbortStorage.run(controller.signal, () =>
      forwardProxyStorage.run(
        payload.forwardProxy || { fProxyEnabled: false },
        () => estimate(payload)
      )
    ),
    timeout,
  ]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  })
}
