import * as cheerio from 'cheerio'
import type { Provider, ProviderLink } from '../types/index.js'

const BASE_URL = 'https://toonhub4u.co'
const TOONSTREAM_URL = 'https://toonstream.one'
const TMDB_URL = 'https://api.themoviedb.org/3'
const REQUEST_TIMEOUT_MS = 10_000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const HEADERS = { Referer: `${BASE_URL}/`, 'User-Agent': USER_AGENT }

interface TmdbDetails {
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
}

interface SearchResult {
  title: string
  url: string
}

interface Candidate {
  url: string
  quality: string
  label?: string
}

interface HostResponse {
  videoSource?: string
  securedLink?: string
}

async function request(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    headers: { ...HEADERS, ...options.headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok)
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`)
  return response
}

function normalize(value = ''): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function similarity(left: string, right: string): number {
  const a = normalize(left)
  const b = normalize(right)
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return 0.9
  const aw = new Set(a.split(' ').filter(word => word.length > 2))
  const bw = new Set(b.split(' ').filter(word => word.length > 2))
  const overlap = [...aw].filter(word => bw.has(word)).length
  return overlap / Math.max(aw.size, bw.size)
}

async function details(
  tmdbId: string,
  mediaType: 'movie' | 'tv'
): Promise<{ title: string; year: string }> {
  const apiKey = process.env.TMDB_API_KEY?.trim()
  if (!apiKey) throw new Error('TMDB_API_KEY is not configured')
  const response = await fetch(
    `${TMDB_URL}/${mediaType}/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(apiKey)}`,
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
  )
  if (!response.ok) throw new Error(`TMDB HTTP ${response.status}`)
  const data = (await response.json()) as TmdbDetails
  return {
    title: data.title || data.name || '',
    year: (data.release_date || data.first_air_date || '').slice(0, 4),
  }
}

async function searchToonHub(title: string): Promise<SearchResult[]> {
  const queries = Array.from(
    new Set([title.split(':')[0].trim(), title, title.split(' ')[0]])
  ).filter(query => query.length >= 3)
  for (const query of queries) {
    try {
      const html = await (
        await request(`${BASE_URL}/?s=${encodeURIComponent(query)}`)
      ).text()
      const $ = cheerio.load(html)
      const results: SearchResult[] = []
      $('li.post-item').each((_index, element) => {
        const anchor = $(element).find('h2.post-title a')
        const url = anchor.attr('href')
        const resultTitle = anchor.text().trim().split('[')[0].trim()
        if (url && resultTitle)
          results.push({ title: resultTitle, url: new URL(url, BASE_URL).href })
      })
      if (results.length) return results
    } catch {
      // Try the next title form.
    }
  }
  return []
}

async function searchToonStream(title: string): Promise<SearchResult[]> {
  try {
    const html = await (
      await request(`${TOONSTREAM_URL}/home/?s=${encodeURIComponent(title)}`, {
        headers: { Referer: `${TOONSTREAM_URL}/` },
      })
    ).text()
    const $ = cheerio.load(html)
    const results: SearchResult[] = []
    $('article.post').each((_index, element) => {
      const anchor = $(element).find('a.lnk-blk')
      const url = anchor.attr('href')
      const resultTitle = $(element).find('.entry-title').text().trim()
      if (url && resultTitle)
        results.push({
          title: resultTitle,
          url: new URL(url, TOONSTREAM_URL).href,
        })
    })
    return results
  } catch {
    return []
  }
}

function bestResult(
  title: string,
  results: SearchResult[],
  mediaType: 'movie' | 'tv',
  season?: number
): SearchResult | undefined {
  return results
    .map(result => {
      let score = similarity(title, result.title)
      const resultSeason = Number(result.title.match(/season\s*(\d+)/i)?.[1])
      if (mediaType === 'tv' && season) {
        if (resultSeason === season) score += 0.2
        else if (resultSeason) score -= 0.2
      }
      return { result, score }
    })
    .filter(item => item.score >= 0.4)
    .sort((left, right) => right.score - left.score)[0]?.result
}

function quality(value: string): string {
  const match = value.match(/\b(2160|1080|720|480|360)p?\b/i)
  return match ? `${match[1]}p` : 'HD'
}

function pageCandidates(
  html: string,
  mediaType: 'movie' | 'tv',
  episode?: number
): Candidate[] {
  const $ = cheerio.load(html)
  const content = $('.entry-content')
  const candidates: Candidate[] = []

  if (mediaType === 'movie') {
    content.find('a[href]').each((_index, element) => {
      const url = $(element).attr('href')
      if (
        url &&
        /\/file\/|\/embed\/|drive\.google|toonstream\.|gdmirror|redirect\//i.test(
          url
        ) &&
        !/toonstream\.net|redirect\/main/i.test(url)
      ) {
        candidates.push({
          url: new URL(url, BASE_URL).href,
          quality: quality(`${$(element).text()} ${url}`),
        })
      }
    })
    return candidates
  }

  const target = episode || 1
  const episodePattern = new RegExp(
    `(?:episode|ep)\\s*0?${target}(?:\\D|$)`,
    'i'
  )
  content.find('p, strong, span, h3').each((_index, element) => {
    if (!episodePattern.test($(element).text())) return
    let current = $(element)
    for (let depth = 0; current.length && depth < 5; depth++) {
      current.find('a[href]').each((_childIndex, anchor) => {
        const url = $(anchor).attr('href')
        if (
          url &&
          !/ads|toonstream\.net|redirect\/main/i.test(url) &&
          !candidates.some(candidate => candidate.url === url)
        ) {
          candidates.push({
            url: new URL(url, BASE_URL).href,
            quality: quality(`${$(anchor).text()} ${current.text()} ${url}`),
            label: `S${String(1).padStart(2, '0')}E${String(target).padStart(2, '0')}`,
          })
        }
      })
      const next = current.next()
      if (
        next.length &&
        /(?:episode|ep)\s*\d+/i.test(next.text()) &&
        !episodePattern.test(next.text())
      )
        break
      current = next
    }
  })
  return candidates
}

async function toonStreamEpisode(
  seriesUrl: string,
  episode: number
): Promise<string | undefined> {
  const html = await (
    await request(seriesUrl, { headers: { Referer: `${TOONSTREAM_URL}/` } })
  ).text()
  const $ = cheerio.load(html)
  const pattern = new RegExp(`(?:episode|ep)\\s*0?${episode}\\b`, 'i')
  let result: string | undefined
  $('article.post.episodes, a[href*="/episode/"]').each((_index, element) => {
    const anchor = $(element).is('a')
      ? $(element)
      : $(element).find('a.lnk-blk')
    const href = anchor.attr('href')
    if (href && pattern.test(`${$(element).text()} ${href}`)) {
      result = new URL(href, TOONSTREAM_URL).href
      return false
    }
  })
  return result
}

function unpack(
  source: string,
  radix: number,
  count: number,
  keywords: string[]
): string {
  const encode = (value: number, base: number): string => {
    if (base <= 36) return value.toString(base)
    const alphabet =
      '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
    let result = ''
    do {
      result = alphabet[value % base] + result
      value = Math.floor(value / base)
    } while (value > 0)
    return result
  }
  while (count--) {
    if (keywords[count])
      source = source.replace(
        new RegExp(`\\b${encode(count, radix)}\\b`, 'g'),
        keywords[count]
      )
  }
  return source
}

function directMediaUrl(html: string): string | undefined {
  let decoded = html.replace(/\\\//g, '/').replace(/&#038;|&amp;/g, '&')
  const packed = html.match(
    /return p\}\('(.*?)',\s*(\d+),\s*(\d+),\s*'(.*?)'\.split\(/s
  )
  if (packed) {
    decoded += `\n${unpack(
      packed[1],
      Number(packed[2]),
      Number(packed[3]),
      packed[4].split('|')
    )}`
  }
  return decoded.match(
    /https?:\/\/[^\s"'\\<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'\\<>]*)?/i
  )?.[0]
}

async function resolveCandidate(
  candidate: Candidate,
  depth = 0
): Promise<string | undefined> {
  if (depth > 4) return undefined
  let url = candidate.url.replace(/&#038;/g, '&')
  if (/redirect\/main.*[?&]url=/i.test(url)) {
    const encoded = new URL(url).searchParams.get('url')
    if (encoded) url = Buffer.from(encoded, 'base64').toString('utf8')
  }

  if (/toonstream\./i.test(url) && /\/episode\//i.test(url)) {
    const html = await (
      await request(url, { headers: { Referer: `${TOONSTREAM_URL}/` } })
    ).text()
    const embed = html.match(
      /https?:\/\/toonstream\.[^/]+\/home\/\?trembed=[^"']+/i
    )?.[0]
    if (embed) return resolveCandidate({ ...candidate, url: embed }, depth + 1)
  }

  if (/toonstream\./i.test(url) && /\/home\//i.test(url)) {
    const html = await (
      await request(url, { headers: { Referer: `${TOONSTREAM_URL}/` } })
    ).text()
    const iframe = html.match(/<iframe[^>]+src=["']([^"']+)/i)?.[1]
    if (iframe)
      return resolveCandidate(
        { ...candidate, url: new URL(iframe, url).href },
        depth + 1
      )
  }

  if (/short\.icu|as-cdn21\.top|abyss\.to/i.test(url)) {
    const id =
      url.match(/\/(?:video|v)\/([a-zA-Z0-9]+)/)?.[1] ||
      new URL(url).searchParams.get('v')
    if (id) {
      const parsed = new URL(url)
      const response = await fetch(
        `${parsed.origin}/player/index.php?data=${encodeURIComponent(id)}&do=getVideo`,
        {
          method: 'POST',
          headers: {
            ...HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: `${TOONSTREAM_URL}/`,
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: new URLSearchParams({
            hash: id,
            r: `${TOONSTREAM_URL}/`,
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }
      )
      if (response.ok) {
        const payload = (await response.json()) as HostResponse
        if (payload.videoSource || payload.securedLink)
          return payload.videoSource || payload.securedLink
      }
    }
  }

  if (/gdmirrorbot\.nl/i.test(url)) {
    const html = await (await request(url)).text()
    const direct = html
      .match(/(?:const|let|var)\s+fileurl\s*=\s*["']([^"']+)/i)?.[1]
      ?.replace(/\\/g, '')
    if (direct) return direct
  }

  if (/\.(?:m3u8|mp4)(?:$|[?#])/i.test(url)) return url
  const html = await (
    await request(url.replace('/file/', '/embed/'), {
      headers: { Referer: BASE_URL },
    })
  ).text()
  return directMediaUrl(html)
}

function audioLabel(url: string): string {
  const decoded = decodeURIComponent(url.replace(/\+/g, ' '))
  const languages = [
    'Hindi',
    'English',
    'Japanese',
    'Tamil',
    'Telugu',
    'Korean',
    'Chinese',
  ].filter(language => new RegExp(`\\b${language}\\b`, 'i').test(decoded))
  if (/multi\s*audio/i.test(decoded) && !languages.length)
    return 'Hindi/English/Japanese'
  return languages.length ? languages.join('/') : 'Hindi/English'
}

async function getStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  try {
    const media = await details(tmdbId, mediaType)
    const [hubResults, streamResults] = await Promise.all([
      searchToonHub(media.title),
      searchToonStream(media.title),
    ])
    const hubMatch = bestResult(media.title, hubResults, mediaType, season)
    let candidates: Candidate[] = []
    if (hubMatch) {
      const html = await (await request(hubMatch.url)).text()
      candidates = pageCandidates(html, mediaType, episode)
    }
    const streamMatch = bestResult(
      hubMatch?.title || media.title,
      streamResults,
      mediaType,
      season
    )
    if (streamMatch && candidates.length < 5) {
      const url =
        mediaType === 'movie'
          ? streamMatch.url
          : await toonStreamEpisode(streamMatch.url, episode || 1)
      if (url) candidates.push({ url, quality: 'HD' })
    }

    const settled = await Promise.allSettled(
      candidates.slice(0, 12).map(async (candidate, index) => {
        const url = await resolveCandidate(candidate)
        if (!url || !/^https?:\/\//i.test(url)) return undefined
        return {
          server: `ToonHub | ${audioLabel(url)} | ${index + 1}`,
          url,
          isM3U8: /\.m3u8(?:$|[?#])/i.test(url),
          quality:
            candidate.quality === 'HD' ? quality(url) : candidate.quality,
          subtitles: [],
          requiresProxy: true,
          headers: { Referer: BASE_URL, 'User-Agent': USER_AGENT },
        } satisfies ProviderLink
      })
    )
    const links = settled.flatMap(result =>
      result.status === 'fulfilled' && result.value ? [result.value] : []
    )
    return Array.from(new Map(links.map(link => [link.url, link])).values())
  } catch (error) {
    console.error(
      `[ToonHub] ${error instanceof Error ? error.message : 'Unknown provider error'}`
    )
    return []
  }
}

export const toonHubProvider: Provider = {
  name: 'ToonHub',
  id: 'toonhub',
  streamMovie: tmdbId => getStreams(tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(tmdbId, 'tv', season, episode),
}
