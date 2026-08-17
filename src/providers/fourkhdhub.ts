import * as cheerio from 'cheerio'
import type { Provider, ProviderLink } from '../types/index.js'

const TMDB_URL = 'https://api.themoviedb.org/3'
const DOMAIN_LIST_URL =
  'https://raw.githubusercontent.com/Anshu78780/json/main/providers.json'
const NGEX_DOMAIN_LIST_URL =
  'https://raw.githubusercontent.com/Xyr0nX/NGEX/refs/heads/main/manifest.json'
const REQUEST_TIMEOUT_MS = 15_000
const DOMAIN_CACHE_TTL_MS = 4 * 60 * 60 * 1000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const REQUEST_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

const HUB_HOST_PATTERN =
  /(?:hubcloud|hubdrive|hubcdn|hblinks|gamerxyt|hub\.yummy|hub\.ymmmy)/i
const DEAD_HOSTS = new Set(['hubcloud.ink'])
const PIXEL_PATTERN = /pixel\.(?:hubcdn|rohitkiskk)/i

interface FourKConfig {
  id: '4khdhub' | '4khdhubnew'
  name: string
  dynamicSources: string[]
  fallbackDomains: string[]
  broadSearch: boolean
}

interface TmdbDetails {
  title: string
  originalTitle: string
  year: number
  episodeTitle?: string
}

interface SearchCard {
  url: string
  title: string
  year: number
  href: string
}

interface Candidate {
  url: string
  label: string
  quality: string
  size: string
  title: string
}

interface PageResponse {
  html?: string
  finalUrl: string
  contentType: string
}

type CheerioElement = ReturnType<cheerio.CheerioAPI>[number]

const domainCache = new Map<string, { value: string; timestamp: number }>()

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function levenshtein(left: string, right: string): number {
  const a = normalizeTitle(left)
  const b = normalizeTitle(right)
  if (!a.length) return b.length
  if (!b.length) return a.length

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let row = 1; row <= a.length; row++) {
    const current = [row]
    for (let column = 1; column <= b.length; column++) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1)
      )
    }
    previous = current
  }
  return previous[b.length]
}

function titleScore(target: string, candidate: string): number {
  const normalizedTarget = normalizeTitle(target)
  const normalizedCandidate = normalizeTitle(candidate)
  if (normalizedTarget === normalizedCandidate) return 1
  const longest = Math.max(normalizedTarget.length, normalizedCandidate.length)
  return longest ? 1 - levenshtein(target, candidate) / longest : 0
}

async function fetchPage(
  url: string,
  referer?: string,
  redirect: RequestRedirect = 'follow',
  cookie?: string
): Promise<PageResponse> {
  const response = await fetch(url, {
    headers: {
      ...REQUEST_HEADERS,
      ...(referer ? { Referer: referer } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      Range: 'bytes=0-2097151',
    },
    redirect,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok && ![301, 302, 303, 307, 308].includes(response.status)) {
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`)
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() || ''
  const finalUrl = response.url || url
  if (/video|audio|mpegurl|octet-stream/.test(contentType)) {
    await response.body?.cancel()
    return { finalUrl, contentType }
  }

  return { html: await response.text(), finalUrl, contentType }
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { ...REQUEST_HEADERS, Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

function getNestedDomain(value: unknown): string | undefined {
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value
  if (!value || typeof value !== 'object') return undefined

  for (const [key, child] of Object.entries(value)) {
    if (/^(url|domain|baseUrl|mainUrl)$/i.test(key)) {
      const match = getNestedDomain(child)
      if (match) return match
    }
  }
  for (const child of Object.values(value)) {
    const match = getNestedDomain(child)
    if (match && /4khdhub/i.test(JSON.stringify(value))) return match
  }
  return undefined
}

function domainFromDocument(document: unknown): string | undefined {
  if (!document || typeof document !== 'object') return undefined
  const record = document as Record<string, unknown>

  for (const key of ['4kHDHub', '4KHDHub', '4khdhub', '4khdhubnew']) {
    const match = getNestedDomain(record[key])
    if (match) return match
  }

  const providers = Array.isArray(record.providers) ? record.providers : []
  for (const provider of providers) {
    if (
      provider &&
      typeof provider === 'object' &&
      /4khdhub/i.test(
        String(
          (provider as Record<string, unknown>).id ||
            (provider as Record<string, unknown>).name ||
            ''
        )
      )
    ) {
      const match = getNestedDomain(provider)
      if (match) return match
    }
  }
  return undefined
}

async function domainIsAlive(domain: string): Promise<boolean> {
  try {
    const page = await fetchPage(domain)
    return /4khdhub/i.test(`${page.finalUrl} ${page.html || ''}`)
  } catch {
    return false
  }
}

async function getBaseUrl(config: FourKConfig): Promise<string> {
  const override = process.env.FOURKHDHUB_BASE_URL?.trim()
  if (override) return override.replace(/\/$/, '')

  const cached = domainCache.get(config.id)
  if (cached && Date.now() - cached.timestamp < DOMAIN_CACHE_TTL_MS) {
    return cached.value
  }

  for (const source of config.dynamicSources) {
    try {
      const candidate = domainFromDocument(await fetchJson(source))
      if (candidate && (await domainIsAlive(candidate))) {
        const value = candidate.replace(/\/$/, '')
        domainCache.set(config.id, { value, timestamp: Date.now() })
        return value
      }
    } catch {
      // Domain registries are optional; continue with the known candidates.
    }
  }

  const checks = await Promise.all(
    config.fallbackDomains.map(async domain => ({
      domain,
      alive: await domainIsAlive(domain),
    }))
  )
  const value = (
    checks.find(check => check.alive)?.domain || config.fallbackDomains[0]
  ).replace(/\/$/, '')
  domainCache.set(config.id, { value, timestamp: Date.now() })
  return value
}

async function getTmdbDetails(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<TmdbDetails | null> {
  const apiKey = process.env.TMDB_API_KEY?.trim()
  if (!apiKey) {
    console.error('[4KHDHub] TMDB_API_KEY is not configured')
    return null
  }

  const url = new URL(`${TMDB_URL}/${mediaType}/${encodeURIComponent(tmdbId)}`)
  url.searchParams.set('api_key', apiKey)
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`TMDB HTTP ${response.status}`)

  const data = (await response.json()) as Record<string, unknown>
  const title = String(data.title || data.name || '')
  if (!title) return null

  const details: TmdbDetails = {
    title,
    originalTitle: String(data.original_title || data.original_name || title),
    year: Number(
      String(data.release_date || data.first_air_date || '').slice(0, 4)
    ),
  }

  if (mediaType === 'tv' && season !== undefined && episode !== undefined) {
    try {
      const episodeUrl = new URL(
        `${TMDB_URL}/tv/${encodeURIComponent(tmdbId)}/season/${season}/episode/${episode}`
      )
      episodeUrl.searchParams.set('api_key', apiKey)
      const episodeResponse = await fetch(episodeUrl, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (episodeResponse.ok) {
        const episodeData = (await episodeResponse.json()) as { name?: string }
        details.episodeTitle = episodeData.name
      }
    } catch {
      // Episode titles improve matching/labels but are not required.
    }
  }

  return details
}

function cardsFromHtml(html: string, baseUrl: string): SearchCard[] {
  const $ = cheerio.load(html)
  const cards: SearchCard[] = []
  const seen = new Set<string>()
  const selectors = [
    'a.movie-card[href]',
    '.movie-card a[href]',
    'div.card-grid a[href]',
    'article a[href]',
    '.post a[href]',
  ].join(', ')

  $(selectors).each((_index, element) => {
    const href = $(element).attr('href')
    if (!href) return
    try {
      const url = new URL(href, baseUrl).href
      if (seen.has(url) || /\/(?:category|tag|author|page|feed)\//i.test(url)) {
        return
      }
      const container = $(element).closest('.movie-card, article, .post')
      const title =
        $('.movie-card-title, h2, h3, h4, .entry-title, .title', container)
          .first()
          .text()
          .trim() ||
        $(element).attr('title') ||
        $('img', element).attr('alt') ||
        $(element).text().trim()
      if (!title) return

      seen.add(url)
      const context = `${title} ${container.text()} ${url}`
      cards.push({
        href,
        url,
        title,
        year: Number(context.match(/\b(?:19|20)\d{2}\b/)?.[0]),
      })
    } catch {
      // Ignore malformed search results.
    }
  })
  return cards
}

function cardMatchesMediaType(card: SearchCard, mediaType: 'movie' | 'tv') {
  const value = `${card.href} ${card.title}`.toLowerCase()
  const looksLikeSeries =
    /-series-?\d*|\/series\/|\bseries\b|\bseason\s*\d+\b/i.test(value)
  return mediaType === 'tv' ? looksLikeSeries : !looksLikeSeries
}

async function searchContent(
  config: FourKConfig,
  details: TmdbDetails,
  mediaType: 'movie' | 'tv'
): Promise<string | null> {
  const baseUrl = await getBaseUrl(config)
  const titles = Array.from(
    new Set([details.title, details.originalTitle].filter(Boolean))
  )

  for (const title of titles) {
    const queries = config.broadSearch
      ? [title, `${title} ${details.year}`]
      : [`${title} ${details.year}`, title]

    for (const query of queries) {
      try {
        const searchUrl = new URL('/', baseUrl)
        searchUrl.searchParams.set('s', query)
        const page = await fetchPage(searchUrl.href, baseUrl)
        const candidates = cardsFromHtml(page.html || '', baseUrl)
          .filter(card => {
            const yearMatches =
              !details.year ||
              !card.year ||
              Math.abs(card.year - details.year) <= 1
            return cardMatchesMediaType(card, mediaType) && yearMatches
          })
          .map(card => ({ ...card, score: titleScore(title, card.title) }))
          .filter(card => card.score >= 0.62)
          .sort((a, b) => b.score - a.score)

        if (candidates[0]) return candidates[0].url
      } catch {
        // Try the next title/query combination.
      }
    }
  }

  return null
}

function qualityFromText(value: string): string {
  const match = value.match(/\b(2160p|1440p|1080p|720p|576p|480p)\b/i)
  if (match) return match[1].toLowerCase()
  if (/\b4k\b|\buhd\b/i.test(value)) return '2160p'
  return 'Auto'
}

function collectCandidates(
  html: string,
  pageUrl: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Candidate[] {
  const $ = cheerio.load(html)
  const elements: CheerioElement[] = []

  if (mediaType === 'tv' && season !== undefined && episode !== undefined) {
    const seasonPattern = new RegExp(`S(?:eason)?\\s*0*${season}(?:\\D|$)`, 'i')
    const episodePattern = new RegExp(
      `Episode-?\\s*0*${episode}(?:\\D|$)|\\bE\\s*0*${episode}(?:\\D|$)`,
      'i'
    )
    $('.episode-item')
      .filter((_index, element) => {
        const label = $('.episode-title, .season-title, h2, h3', element)
          .first()
          .text()
        return seasonPattern.test(label)
      })
      .each((_index, element) => {
        $('.episode-download-item', element)
          .filter((_childIndex, child) => episodePattern.test($(child).text()))
          .each((_childIndex, child) => {
            elements.push(child)
          })
      })

    // Some templates omit the episode wrapper or use a season heading outside
    // the download block. The reference provider falls back to a page-wide
    // episode scan in that case.
    if (elements.length === 0) {
      $('div.episode-download-item')
        .filter((_index, element) => episodePattern.test($(element).text()))
        .each((_index, element) => {
          const parent = $(element).closest('.episode-item')
          const seasonLabel = parent
            .find('.episode-title, .season-title, h2, h3')
            .first()
            .text()
          if (!seasonLabel || seasonPattern.test(seasonLabel)) {
            elements.push(element)
          }
        })
    }
  } else {
    $('.download-item').each((_index, element) => {
      elements.push(element)
    })
  }

  const results: Candidate[] = []
  const seen = new Set<string>()
  for (const element of elements) {
    const localHtml = $(element).html() || ''
    const title = $('.file-title, .episode-file-title', element).text().trim()
    const size = localHtml.match(/([\d.]+\s?[GM]B)/i)?.[1] || ''
    const quality = qualityFromText(`${title} ${localHtml}`)

    $('a[href]', element).each((_index, anchor) => {
      const href = $(anchor).attr('href')
      if (!href) return
      try {
        const url = new URL(href, pageUrl).href
        if (seen.has(url) || PIXEL_PATTERN.test(url)) return
        seen.add(url)
        results.push({
          url,
          label: $(anchor).text().replace(/\s+/g, ' ').trim(),
          quality,
          size,
          title,
        })
      } catch {
        // Ignore malformed download buttons.
      }
    })
  }

  return results.filter(candidate =>
    HUB_HOST_PATTERN.test(candidate.url + candidate.label)
  )
}

function decodeLegacyRedirect(html: string): string | undefined {
  try {
    const encoded = html.match(/'o','(.*?)'/)?.[1]
    if (!encoded) return undefined
    const first = Buffer.from(encoded, 'base64').toString('utf8')
    const second = Buffer.from(first, 'base64').toString('utf8')
    const rotated = second.replace(/[A-Za-z]/g, character => {
      const start = character <= 'Z' ? 65 : 97
      return String.fromCharCode(
        ((character.charCodeAt(0) - start + 13) % 26) + start
      )
    })
    const data = JSON.parse(
      Buffer.from(rotated, 'base64').toString('utf8')
    ) as { o?: string }
    return data.o ? Buffer.from(data.o, 'base64').toString('utf8') : undefined
  } catch {
    return undefined
  }
}

function isPlayableUrl(url: string): boolean {
  const lower = url.toLowerCase()
  if (
    /accounts\.google\.com|google\.com\/search|^https?:\/\/t\.me\//i.test(lower)
  ) {
    return false
  }
  return (
    /\.(?:mkv|mp4|m3u8|webm)(?:[?#]|$)/i.test(lower) ||
    /googleusercontent\.com|storage\.googleapis\.com/i.test(lower)
  )
}

function decodeRedirectValue(value: string, pageUrl: string): string[] {
  const results: string[] = []
  try {
    const url = new URL(value, pageUrl)
    const link = url.searchParams.get('link')
    if (link) results.push(decodeURIComponent(link))

    const encoded = url.searchParams.get('r')
    if (encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8')
      const decodedUrl = new URL(decoded, pageUrl)
      results.push(
        decodedUrl.searchParams.get('link')
          ? decodeURIComponent(decodedUrl.searchParams.get('link') || '')
          : decodedUrl.href
      )
    }

    if (!link && !encoded) results.push(url.href)
  } catch {
    // Ignore malformed scripted redirects.
  }
  return results.filter(Boolean)
}

function linksFromPage(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html)
  const links: Array<{ url: string; score: number }> = []

  const redirectPatterns = [
    /(?:var|let|const)\s+(?:re)?url\s*=\s*['"]([^'"]+)['"]/gi,
    /window\.location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/gi,
    /location\.replace\(['"]([^'"]+)['"]\)/gi,
    /location\.assign\(['"]([^'"]+)['"]\)/gi,
    /<meta[^>]*http-equiv=["']?refresh["']?[^>]*content=["']?\d+;\s*url=([^"'>]+)/gi,
    /data-(?:url|href|link)\s*=\s*['"]([^'"]+)['"]/gi,
  ]
  for (const pattern of redirectPatterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(html)) !== null) {
      for (const url of decodeRedirectValue(match[1], pageUrl)) {
        links.push({ url, score: 100 })
      }
    }
  }

  $('a[href]').each((_index, anchor) => {
    const href = $(anchor).attr('href')
    if (!href) return
    try {
      const url = new URL(href, pageUrl).href
      const label = $(anchor).text().replace(/\s+/g, ' ').trim()
      let score = 0
      if (/download file|10gbps|fsl|buzz|instant|resume/i.test(label))
        score += 80
      if (isPlayableUrl(url)) score += 70
      if (HUB_HOST_PATTERN.test(url)) score += 50
      if (/download|generate/i.test(href)) score += 20
      if (score) links.push({ url, score })
    } catch {
      // Ignore invalid anchors.
    }
  })

  return Array.from(
    new Map(
      links.sort((a, b) => b.score - a.score).map(link => [link.url, link.url])
    ).values()
  )
}

async function resolveCandidate(
  url: string,
  referer: string,
  visited = new Set<string>(),
  depth = 0,
  cookie?: string
): Promise<string[]> {
  if (depth > 5 || visited.has(url) || PIXEL_PATTERN.test(url)) return []
  visited.add(url)

  try {
    const parsed = new URL(url)
    if (DEAD_HOSTS.has(parsed.hostname)) return []
    const embeddedLink = parsed.searchParams.get('link')
    if (embeddedLink) {
      return resolveCandidate(
        decodeURIComponent(embeddedLink),
        parsed.href,
        visited,
        depth + 1,
        cookie
      )
    }
    // Extensionless worker/CDN URLs are frequently HTML landing pages. Always
    // request them and inspect the response instead of assuming they are media.
    if (
      isPlayableUrl(parsed.href) &&
      !/workers\.dev|hubcdn/i.test(parsed.href)
    ) {
      return [parsed.href]
    }

    const response = await fetchPage(parsed.href, referer, 'follow', cookie)
    const finalParsed = new URL(response.finalUrl)
    const finalEmbeddedLink = finalParsed.searchParams.get('link')
    if (finalEmbeddedLink) {
      return resolveCandidate(
        decodeURIComponent(finalEmbeddedLink),
        response.finalUrl,
        visited,
        depth + 1,
        cookie
      )
    }
    if (
      isPlayableUrl(response.finalUrl) ||
      (/video|mpegurl|octet-stream/.test(response.contentType) &&
        !/accounts\.google\.com|google\.com\/search/i.test(response.finalUrl))
    ) {
      return [response.finalUrl]
    }

    const html = response.html || ''
    const legacyRedirect = decodeLegacyRedirect(html)
    const cookieName = html.match(/stck\(\s*['"](\w+)['"]\s*,/)?.[1]
    const nextCookie = cookieName ? `${cookieName}=s4t` : undefined
    const nextLinks = [
      ...(legacyRedirect ? [legacyRedirect] : []),
      ...linksFromPage(html, response.finalUrl),
    ]
    const settled = await Promise.allSettled(
      nextLinks
        .slice(0, 8)
        .map(next =>
          resolveCandidate(
            next,
            response.finalUrl,
            visited,
            depth + 1,
            nextCookie
          )
        )
    )
    const results = settled.flatMap(result =>
      result.status === 'fulfilled' ? result.value : []
    )

    return Array.from(new Set(results))
  } catch {
    return []
  }
}

function candidateScore(candidate: Candidate): number {
  const value = `${candidate.label} ${candidate.url}`.toLowerCase()
  if (/10gbps|buzz|fsl/.test(value)) return 100
  if (/hubcdn/.test(value)) return 80
  if (/hubcloud/.test(value)) return 60
  if (/hubdrive/.test(value)) return 40
  return 20
}

async function extractLinks(candidates: Candidate[]): Promise<ProviderLink[]> {
  const sorted = candidates.sort(
    (left, right) => candidateScore(right) - candidateScore(left)
  )
  const settled = await Promise.allSettled(
    sorted.slice(0, 12).map(async candidate => ({
      candidate,
      urls: await resolveCandidate(candidate.url, candidate.url),
    }))
  )

  const links: ProviderLink[] = []
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue
    for (const url of result.value.urls) {
      const { candidate } = result.value
      links.push({
        server: `4KHDHub | ${candidate.label || 'Direct'}${candidate.size ? ` | ${candidate.size}` : ''}`,
        url,
        isM3U8: /\.m3u8(?:$|[?#])/i.test(url),
        quality: candidate.quality,
        subtitles: [],
        headers: {
          'User-Agent': USER_AGENT,
          Referer: candidate.url,
          Range: 'bytes=0-',
        },
      })
    }
  }

  return Array.from(new Map(links.map(link => [link.url, link])).values())
}

async function getStreams(
  config: FourKConfig,
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  try {
    const details = await getTmdbDetails(tmdbId, mediaType, season, episode)
    if (!details) return []

    const pageUrl = await searchContent(config, details, mediaType)
    if (!pageUrl) {
      console.log(`[${config.name}] No matching page for "${details.title}"`)
      return []
    }

    const page = await fetchPage(pageUrl)
    const candidates = collectCandidates(
      page.html || '',
      page.finalUrl,
      mediaType,
      season,
      episode
    )
    const links = await extractLinks(candidates)
    console.log(`[${config.name}] Resolved ${links.length} playable link(s)`)
    return links
  } catch (error) {
    console.error(
      `[${config.name}] Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return []
  }
}

const classicConfig: FourKConfig = {
  id: '4khdhub',
  name: '4KHDHub',
  dynamicSources: [DOMAIN_LIST_URL],
  fallbackDomains: [
    'https://4khdhub.link',
    'https://4khdhub.fans',
    'https://4khdhub.click',
    'https://4khdhub.ink',
    'https://4khdhub.one',
    'https://4khdhub.to',
    'https://4khdhub.cc',
  ],
  broadSearch: false,
}

const newConfig: FourKConfig = {
  id: '4khdhubnew',
  name: '4KHDHub-NEW',
  dynamicSources: [NGEX_DOMAIN_LIST_URL, DOMAIN_LIST_URL],
  fallbackDomains: [
    'https://4khdhub.dad',
    'https://4khdhub.link',
    'https://4khdhub.click',
  ],
  broadSearch: true,
}

export const fourKHDHubProvider: Provider = {
  name: classicConfig.name,
  id: classicConfig.id,
  alias: 'Gondar',
  streamMovie: tmdbId => getStreams(classicConfig, tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(classicConfig, tmdbId, 'tv', season, episode),
}

export const fourKHDHubNewProvider: Provider = {
  name: newConfig.name,
  id: newConfig.id,
  alias: 'Dallol',
  streamMovie: tmdbId => getStreams(newConfig, tmdbId, 'movie'),
  streamTV: (tmdbId, season, episode) =>
    getStreams(newConfig, tmdbId, 'tv', season, episode),
}
