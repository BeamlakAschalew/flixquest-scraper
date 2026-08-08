import * as cheerio from 'cheerio'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/config.js'

const DEFAULT_BASE_URL = 'https://dlhd.st'
const DEFAULT_EMBED_BASE_URL =
  'https://hamis.romponalis.st/premiumtv/daddy3.php'
const CHANNELS_CACHE_TTL_MS = 15 * 60 * 1000
const EPG_CACHE_TTL_MS = 5 * 60 * 1000
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'

export interface DlhdChannel {
  id: string
  name: string
  letter: string
  watchUrl: string
  playerUrl: string
}

export interface DlhdEpgChannel {
  id: string
  name: string
  watchUrl: string
}

export interface DlhdEpgEvent {
  id: string
  time: string
  title: string
  startsAt?: string
  channels: DlhdEpgChannel[]
}

export interface DlhdEpgCategory {
  name: string
  slug: string
  events: DlhdEpgEvent[]
}

export interface DlhdEpgDay {
  date?: string
  label: string
  categories: DlhdEpgCategory[]
}

export interface DlhdStream {
  url: string
  isM3U8: true
  headers: Record<string, string>
  embedUrl: string
  expiresAt?: string
}

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

let channelsCache: CacheEntry<DlhdChannel[]> | undefined
let epgCache: CacheEntry<DlhdEpgDay[]> | undefined

function configuredUrl(name: string, fallback: string): string {
  const configured = process.env[name]?.trim()
  return new URL(configured || fallback).href.replace(/\/$/, '')
}

function baseUrl(): string {
  return configuredUrl('DLHD_BASE_URL', DEFAULT_BASE_URL)
}

function siteHeaders(referer = `${baseUrl()}/`): Record<string, string> {
  return {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: referer,
    'User-Agent': USER_AGENT,
  }
}

async function requestText(
  url: string,
  headers: Record<string, string> = siteHeaders()
): Promise<{ text: string; url: string }> {
  const response = await fetch(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`DLHD upstream returned HTTP ${response.status}`)
  }

  return { text: await response.text(), url: response.url }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function channelIdFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined

  try {
    const parsed = new URL(value, baseUrl())
    const id = parsed.searchParams.get('id')
    return id && /^\d+$/.test(id) ? id : undefined
  } catch {
    return undefined
  }
}

export function parseDlhdChannels(html: string): DlhdChannel[] {
  const $ = cheerio.load(html)
  const channels: DlhdChannel[] = []

  $('a.card[href*="watch.php?id="]').each((_index, element) => {
    const anchor = $(element)
    const id = channelIdFromUrl(anchor.attr('href'))
    const name = normalizeWhitespace(
      anchor.find('.card__title').first().text() ||
        anchor.attr('data-title') ||
        ''
    )
    if (!id || !name) return

    channels.push({
      id,
      name,
      letter: (anchor.attr('data-first') || name.charAt(0)).toUpperCase(),
      watchUrl: new URL(`/watch.php?id=${id}`, baseUrl()).href,
      playerUrl: new URL(`/stream/stream-${id}.php`, baseUrl()).href,
    })
  })

  return Array.from(
    new Map(channels.map(channel => [channel.id, channel])).values()
  )
}

const MONTHS: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
}

function dateFromLabel(label: string): string | undefined {
  const match = label.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(\d{4})\b/
  )
  if (!match) return undefined

  const month = MONTHS[match[2].slice(0, 3).toLowerCase()]
  if (!month) return undefined
  return `${match[3]}-${month}-${match[1].padStart(2, '0')}`
}

function startsAt(date: string | undefined, time: string): string | undefined {
  if (!date || !/^\d{1,2}:\d{2}$/.test(time)) return undefined
  const [hour, minute] = time.split(':').map(Number)
  if (hour > 23 || minute > 59) return undefined
  return `${date}T${time.padStart(5, '0')}:00Z`
}

export function parseDlhdEpg(html: string): DlhdEpgDay[] {
  const $ = cheerio.load(html)
  const days: DlhdEpgDay[] = []

  $('.schedule__day').each((_dayIndex, dayElement) => {
    const day = $(dayElement)
    const label = normalizeWhitespace(
      day.children('.schedule__dayTitle').first().text()
    )
    const date = dateFromLabel(label)
    const categories: DlhdEpgCategory[] = []

    day
      .children('.schedule__category')
      .each((_categoryIndex, categoryElement) => {
        const category = $(categoryElement)
        const name = normalizeWhitespace(
          category
            .children('.schedule__catHeader')
            .find('.card__meta')
            .first()
            .text()
        )
        if (!name) return

        const events: DlhdEpgEvent[] = []
        category
          .children('.schedule__categoryBody')
          .find('.schedule__event')
          .each((_eventIndex, eventElement) => {
            const event = $(eventElement)
            const header = event.children('.schedule__eventHeader').first()
            const time = normalizeWhitespace(
              header.find('.schedule__time').first().attr('data-time') ||
                header.find('.schedule__time').first().text()
            )
            const title = normalizeWhitespace(
              header.find('.schedule__eventTitle').first().text()
            )
            if (!title) return

            const eventChannels: DlhdEpgChannel[] = []
            event
              .children('.schedule__channels')
              .find('a[href*="watch.php?id="]')
              .each((_channelIndex, channelElement) => {
                const anchor = $(channelElement)
                const id = channelIdFromUrl(anchor.attr('href'))
                const channelName = normalizeWhitespace(
                  anchor.attr('title') || anchor.text()
                )
                if (!id || !channelName) return
                eventChannels.push({
                  id,
                  name: channelName,
                  watchUrl: new URL(`/watch.php?id=${id}`, baseUrl()).href,
                })
              })

            const eventSlug = slugify(
              `${date || label}-${name}-${time}-${title}`
            )
            events.push({
              id: eventSlug,
              time,
              title,
              startsAt: startsAt(date, time),
              channels: Array.from(
                new Map(
                  eventChannels.map(channel => [channel.id, channel])
                ).values()
              ),
            })
          })

        categories.push({ name, slug: slugify(name), events })
      })

    if (label || categories.length) days.push({ date, label, categories })
  })

  return days
}

export async function getDlhdChannels(refresh = false): Promise<DlhdChannel[]> {
  if (!refresh && channelsCache && channelsCache.expiresAt > Date.now()) {
    return channelsCache.value
  }

  const { text } = await requestText(
    new URL('/24-7-channels.php', baseUrl()).href
  )
  const channels = parseDlhdChannels(text)
  if (!channels.length) throw new Error('DLHD returned no channels')

  channelsCache = {
    value: channels,
    expiresAt: Date.now() + CHANNELS_CACHE_TTL_MS,
  }
  return channels
}

export async function getDlhdEpg(refresh = false): Promise<DlhdEpgDay[]> {
  if (!refresh && epgCache && epgCache.expiresAt > Date.now()) {
    return epgCache.value
  }

  const { text } = await requestText(`${baseUrl()}/`)
  const days = parseDlhdEpg(text)
  if (!days.length) throw new Error('DLHD returned no EPG entries')

  epgCache = { value: days, expiresAt: Date.now() + EPG_CACHE_TTL_MS }
  return days
}

function embedUrlFromBase(base: string, channelId: string): string {
  const url = new URL(base)
  url.searchParams.set('id', channelId)
  return url.href
}

function discoveredEmbedUrls(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html)
  const candidates: string[] = []

  $('#thatframe[src], iframe[src]').each((_index, element) => {
    const src = $(element).attr('src')
    if (!src) return
    try {
      const url = new URL(src, pageUrl)
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        candidates.push(url.href)
      }
    } catch {
      // Ignore malformed advertising iframes.
    }
  })

  return Array.from(new Set(candidates)).sort((left, right) => {
    const score = (value: string) =>
      /premiumtv|daddy\d*\.php|embed/i.test(value) ? 1 : 0
    return score(right) - score(left)
  })
}

export function parseDlhdM3u8Urls(html: string, embedUrl: string): string[] {
  const candidates: string[] = []

  for (const match of html.matchAll(
    /(?:window\.)?atob\(\s*['"]([^'"]+)['"]\s*\)/gi
  )) {
    try {
      const decoded = Buffer.from(match[1], 'base64').toString('utf8').trim()
      candidates.push(decoded)
    } catch {
      // Ignore unrelated or malformed base64 values.
    }
  }

  const unescaped = html
    .replace(/\\\//g, '/')
    .replace(/&amp;|&#0*38;/gi, '&')
    .replace(/\\u0026/gi, '&')
  for (const match of unescaped.matchAll(
    /(?:https?:)?\/\/[^\s'"<>]+\.m3u8(?:\?[^\s'"<>]*)?/gi
  )) {
    candidates.push(match[0])
  }

  return Array.from(
    new Set(
      candidates.flatMap(candidate => {
        try {
          const url = new URL(candidate, embedUrl)
          return url.protocol === 'http:' || url.protocol === 'https:'
            ? [url.href]
            : []
        } catch {
          return []
        }
      })
    )
  ).filter(url => /\.m3u8(?:$|[?#])/i.test(url))
}

function playbackHeaders(embedUrl: string): Record<string, string> {
  const origin = new URL(embedUrl).origin
  return {
    Accept: '*/*',
    Origin: origin,
    Referer: `${origin}/`,
    'User-Agent': USER_AGENT,
  }
}

function streamExpiry(url: string): string | undefined {
  const nowSeconds = Math.floor(Date.now() / 1000)
  for (const match of new URL(url).pathname.matchAll(
    /(?:^|\/)(\d{10})(?:\/|$)/g
  )) {
    const timestamp = Number(match[1])
    if (timestamp > nowSeconds - 86400 && timestamp < nowSeconds + 86400 * 30) {
      return new Date(timestamp * 1000).toISOString()
    }
  }
  return undefined
}

async function validateM3u8(
  url: string,
  headers: Record<string, string>
): Promise<string | undefined> {
  try {
    const response = await fetch(url, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) return undefined
    const text = await response.text()
    return /^\s*#EXTM3U\b/i.test(text) ? response.url : undefined
  } catch {
    return undefined
  }
}

async function extractFromEmbed(
  embedUrl: string
): Promise<DlhdStream | undefined> {
  try {
    const { text, url: finalEmbedUrl } = await requestText(
      embedUrl,
      siteHeaders(`${baseUrl()}/`)
    )
    const headers = playbackHeaders(finalEmbedUrl)

    for (const candidate of parseDlhdM3u8Urls(text, finalEmbedUrl)) {
      const validatedUrl = await validateM3u8(candidate, headers)
      if (!validatedUrl) continue
      return {
        url: validatedUrl,
        isM3U8: true,
        headers,
        embedUrl: finalEmbedUrl,
        expiresAt: streamExpiry(validatedUrl),
      }
    }
  } catch {
    // The current embed host changes periodically; discovery runs next.
  }

  return undefined
}

export async function getDlhdStream(channelId: string): Promise<DlhdStream> {
  if (!/^\d+$/.test(channelId)) throw new Error('Invalid DLHD channel ID')

  const configuredEmbed = configuredUrl(
    'DLHD_EMBED_BASE_URL',
    DEFAULT_EMBED_BASE_URL
  )
  const initialUrl = embedUrlFromBase(configuredEmbed, channelId)
  const initialStream = await extractFromEmbed(initialUrl)
  if (initialStream) return initialStream

  const discoveryPage = new URL(
    `/watch/stream-${encodeURIComponent(channelId)}.php`,
    baseUrl()
  ).href
  const { text, url } = await requestText(discoveryPage)
  const candidates = discoveredEmbedUrls(text, url)

  for (const candidate of candidates) {
    if (candidate === initialUrl) continue
    const stream = await extractFromEmbed(candidate)
    if (stream) return stream
  }

  throw new Error(`No playable DLHD M3U8 found for channel ${channelId}`)
}
