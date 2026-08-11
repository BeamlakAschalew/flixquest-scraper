#!/usr/bin/env node

import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'

const BASE_URL = process.env.AUDIT_BASE_URL || 'http://127.0.0.1:3000'
const OUTPUT = process.env.AUDIT_OUTPUT || '/tmp/flixquest-provider-ranking.json'
const CONCURRENCY = Number(process.env.AUDIT_CONCURRENCY || 3)
const REQUEST_TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS || 55000)
const MANIFEST_TIMEOUT_MS = Number(process.env.AUDIT_MANIFEST_TIMEOUT_MS || 12000)
const USE_EXTERNAL_SERVER = process.env.AUDIT_EXTERNAL_SERVER === 'true'
const NETWORK_RETRIES = Number(process.env.AUDIT_NETWORK_RETRIES || 2)
const RETRY_TIMEOUT_MS = Number(process.env.AUDIT_RETRY_TIMEOUT_MS || 90000)
const RETRY_BACKOFF_MS = Number(process.env.AUDIT_RETRY_BACKOFF_MS || 2500)
const ONLY_PROVIDERS = new Set(
  String(process.env.AUDIT_PROVIDERS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
)
const ONLY_MEDIA_IDS = new Set(
  String(process.env.AUDIT_MEDIA_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
)
const MATRIX_MODE = process.env.AUDIT_MATRIX || 'affinity'

const cases = {
  hollywood: {
    movies: [
      ['27205', 'Inception'],
      ['872585', 'Oppenheimer'],
    ],
    tv: [
      ['1396', 1, 1, 'Breaking Bad S1E1'],
      ['66732', 1, 1, 'Stranger Things S1E1'],
    ],
  },
  indian: {
    movies: [
      ['19404', '3 Idiots'],
      ['579974', 'RRR'],
    ],
    tv: [
      ['79744', 1, 1, 'Sacred Games S1E1'],
      ['121750', 1, 1, 'The Family Man S1E1'],
    ],
  },
  korean: {
    movies: [
      ['496243', 'Parasite'],
      ['845783', 'The 8th Night'],
    ],
    tv: [
      ['93405', 1, 1, 'Squid Game S1E1'],
      ['215720', 1, 1, 'Queen of Tears S1E1'],
    ],
  },
  anime: {
    movies: [
      ['372058', 'Your Name'],
      ['635302', 'Demon Slayer: Mugen Train'],
    ],
    tv: [
      ['85937', 1, 1, 'Demon Slayer S1E1'],
      ['1429', 1, 1, 'Attack on Titan S1E1'],
    ],
  },
  turkish: {
    movies: [
      ['464111', 'Miracle in Cell No. 7 (Turkish)'],
      ['65754', 'Recep Ivedik'],
    ],
    tv: [
      ['75219', 1, 1, 'Dirilis: Ertugrul S1E1'],
      ['79026', 1, 1, 'The Protector S1E1'],
    ],
  },
  spanish: {
    movies: [
      ['17473', 'The Secret in Their Eyes'],
      ['1690', "Pan's Labyrinth"],
    ],
    tv: [
      ['71446', 1, 1, 'Money Heist S1E1'],
      ['73021', 1, 1, 'Cable Girls S1E1'],
    ],
  },
  french: {
    movies: [
      ['194', 'Amelie'],
      ['77338', 'The Intouchables'],
    ],
    tv: [
      ['1408', 1, 1, 'House S1E1'],
      ['1418', 1, 1, 'The Big Bang Theory S1E1'],
    ],
  },
  animation: {
    movies: [
      ['150540', 'Inside Out'],
      ['508442', 'Soul'],
    ],
    tv: [
      ['60625', 1, 1, 'Rick and Morty S1E1'],
      ['246', 1, 1, 'Avatar: The Last Airbender S1E1'],
    ],
  },
}

const CONTENT_CATEGORIES = String(
  process.env.AUDIT_CATEGORIES || Object.keys(cases).join(',')
)
  .split(',')
  .map(value => value.trim())
  .filter(category => category in cases)

const affinity = {
  bollyflix: 'indian', netmirror: 'indian', tamilian: 'indian', uhdmovies: 'indian',
  '4khdhub': 'indian', '4khdhubnew': 'indian', movieblast: 'indian', playimdb: 'indian',
  peachify: 'indian', xpass: 'indian', castle: 'indian',
  kisskh: 'korean', dramafull: 'korean',
  toonhub: 'anime', cuevana: 'spanish', notorrent: 'spanish',
  jetfilmizle: 'turkish', movix: 'french', purstream: 'french',
}

const originalLanguage = {
  '27205': 'English', '872585': 'English', '1396': 'English', '66732': 'English',
  '19404': 'Hindi', '579974': 'Telugu', '79744': 'Hindi', '121750': 'Hindi',
  '496243': 'Korean', '845783': 'Korean', '93405': 'Korean', '215720': 'Korean',
  '372058': 'Japanese', '635302': 'Japanese', '85937': 'Japanese', '1429': 'Japanese',
  '464111': 'Turkish', '65754': 'Turkish', '75219': 'Turkish', '79026': 'Turkish',
  '17473': 'Spanish', '1690': 'Spanish', '71446': 'Spanish', '73021': 'Spanish',
  '194': 'French', '77338': 'French', '1408': 'English', '1418': 'English',
  '150540': 'English', '508442': 'English', '60625': 'English', '246': 'English',
}

function timeout(ms) {
  return AbortSignal.timeout(ms)
}

async function fetchJson(url, ms = REQUEST_TIMEOUT_MS) {
  const response = await fetch(url, { signal: timeout(ms), headers: { 'x-cache-bypass': '1' } })
  const text = await response.text()
  let data
  try { data = JSON.parse(text) } catch { data = { success: false, error: `Non-JSON HTTP ${response.status}` } }
  return { response, data }
}

function isNetworkFailure(result) {
  if (!result) return true
  if ([408, 425, 429, 500, 502, 503, 504].includes(result.response?.status)) return true
  const message = String(result.data?.error || result.error || '').toLowerCase()
  return /timeout|timed out|aborted|fetch failed|econn|enotfound|socket|tls|network|temporarily unavailable|rate limit|cloudflare/i.test(message)
}

function attrs(line) {
  const result = {}
  for (const match of line.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) {
    result[match[1]] = match[2].replace(/^"|"$/g, '')
  }
  return result
}

function normalizeLanguage(value) {
  const v = String(value || '').trim().toLowerCase()
  const names = {
    en: 'English', eng: 'English', english: 'English',
    hi: 'Hindi', hin: 'Hindi', hindi: 'Hindi',
    ja: 'Japanese', jpn: 'Japanese', japanese: 'Japanese',
    ko: 'Korean', kor: 'Korean', korean: 'Korean',
    tr: 'Turkish', tur: 'Turkish', turkish: 'Turkish', 'türkçe': 'Turkish',
    es: 'Spanish', spa: 'Spanish', spanish: 'Spanish', castellano: 'Spanish', latino: 'Spanish (Latino)',
    fr: 'French', fra: 'French', fre: 'French', french: 'French',
    de: 'German', deu: 'German', ger: 'German', german: 'German',
    pt: 'Portuguese', por: 'Portuguese', portuguese: 'Portuguese',
    te: 'Telugu', tel: 'Telugu', telugu: 'Telugu',
    ta: 'Tamil', tam: 'Tamil', tamil: 'Tamil',
    ar: 'Arabic', ara: 'Arabic', arabic: 'Arabic',
  }
  return names[v] || (value ? String(value).trim() : undefined)
}

function languagesFromText(text, mediaId) {
  const found = new Set()
  const patterns = [
    ['English', /\benglish\b|\beng\b/i], ['Hindi', /\bhindi\b|\bhin\b/i],
    ['Japanese', /\bjapanese\b|\bjpn\b/i], ['Korean', /\bkorean\b|\bkor\b/i],
    ['Turkish', /\bturkish\b|türkçe/i], ['Spanish (Latino)', /\blatino\b/i],
    ['Spanish', /\bspanish\b|castellano|español/i], ['French', /\bfrench\b|français/i],
    ['German', /\bgerman\b|deutsch/i], ['Portuguese', /\bportuguese\b|português/i],
    ['Telugu', /\btelugu\b/i], ['Tamil', /\btamil\b/i], ['Arabic', /\barabic\b|العربية/i],
  ]
  for (const [name, regex] of patterns) if (regex.test(text)) found.add(name)
  if (/original(?: asian)? audio/i.test(text) && originalLanguage[mediaId]) found.add(originalLanguage[mediaId])
  return [...found]
}

function heightsFromManifest(text) {
  const heights = new Set()
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue
    const match = line.match(/RESOLUTION=\d+x(\d+)/i)
    if (match) heights.add(Number(match[1]))
  }
  return [...heights].sort((a, b) => a - b)
}

async function inspectLink(link, mediaId) {
  const languages = new Set(languagesFromText(`${link.server || ''} ${link.quality || ''}`, mediaId))
  const heights = new Set()
  const q = String(link.quality || '').match(/(2160|1440|1080|720|576|540|480|360)p/i)
  if (q) heights.add(Number(q[1]))
  const evidence = []
  let manifestChecked = false
  const target = link.hlsVariant || link.url

  if (link.isM3U8 || /\.m3u8(?:$|[?#])/i.test(target)) {
    try {
      const response = await fetch(target, {
        signal: timeout(MANIFEST_TIMEOUT_MS),
        headers: { ...(link.headers || {}), Range: 'bytes=0-131071' },
      })
      const text = await response.text()
      if (text.includes('#EXTM3U')) {
        manifestChecked = true
        for (const height of heightsFromManifest(text)) heights.add(height)
        for (const line of text.split(/\r?\n/)) {
          if (!line.startsWith('#EXT-X-MEDIA:') || !/TYPE=AUDIO/i.test(line)) continue
          const a = attrs(line)
          const language = normalizeLanguage(a.LANGUAGE || a.NAME)
          if (language) languages.add(language)
        }
        evidence.push(`HLS HTTP ${response.status}`)
      } else evidence.push(`manifest response was not HLS (HTTP ${response.status})`)
    } catch (error) {
      evidence.push(`manifest inspection failed: ${error instanceof Error ? error.name : 'error'}`)
    }
  }

  return { languages: [...languages], heights: [...heights], manifestChecked, evidence }
}

function buildCases(provider) {
  if (MATRIX_MODE === 'universal') {
    return CONTENT_CATEGORIES.flatMap(category => {
      const matrix = cases[category]
      return [
        ...matrix.movies.map(([tmdbId, title]) => ({
          type: 'movie', tmdbId, title, category,
        })),
        ...matrix.tv.map(([tmdbId, season, episode, title]) => ({
          type: 'tv', tmdbId, season, episode, title, category,
        })),
      ]
    })
  }
  const regional = cases[affinity[provider] || 'hollywood']
  const common = cases.hollywood
  const merged = {
    movies: [...common.movies, ...(regional === common ? [] : regional.movies)],
    tv: [...common.tv, ...(regional === common ? [] : regional.tv)],
  }
  return [
    ...merged.movies.map(([tmdbId, title]) => ({ type: 'movie', tmdbId, title, category: regional === common ? 'hollywood' : undefined })),
    ...merged.tv.map(([tmdbId, season, episode, title]) => ({ type: 'tv', tmdbId, season, episode, title, category: regional === common ? 'hollywood' : undefined })),
  ]
}

async function testCase(provider, item) {
  const query = item.type === 'movie'
    ? `/api/v2/stream-movie?tmdbId=${item.tmdbId}&provider=${provider}&proxy=false&skipCache=true`
    : `/api/v2/stream-tv?tmdbId=${item.tmdbId}&season=${item.season}&episode=${item.episode}&provider=${provider}&proxy=false&skipCache=true`
  const started = Date.now()
  let attemptCount = 0
  let lastFailure
  for (let attempt = 0; attempt <= NETWORK_RETRIES; attempt++) {
    attemptCount = attempt + 1
    try {
    const { response, data } = await fetchJson(`${BASE_URL}${query}`, attempt ? RETRY_TIMEOUT_MS : REQUEST_TIMEOUT_MS)
    const links = Array.isArray(data.links) ? data.links : []
    const inspections = []
    for (const link of links.slice(0, 4)) inspections.push(await inspectLink(link, item.tmdbId))
    const languages = [...new Set(inspections.flatMap(x => x.languages))]
    const heights = [...new Set(inspections.flatMap(x => x.heights))].sort((a, b) => a - b)
    const result = {
      ...item, success: Boolean(data.success && links.length), httpStatus: response.status,
      elapsedMs: Date.now() - started, linkCount: links.length,
      qualities: [...new Set(links.map(link => link.quality).filter(Boolean))], heights, languages,
      languageEvidence: languages.length ? 'stream/server metadata or HLS audio rendition' : 'not detectable from returned stream metadata',
      manifestChecks: inspections.filter(x => x.manifestChecked).length,
      error: data.success && !links.length ? 'No validated streams returned' : data.error,
      servers: [...new Set(links.map(link => link.server).filter(Boolean))],
    }
    result.attemptCount = attemptCount
    result.networkRetried = attempt > 0
    if (result.success || !isNetworkFailure(result) || attempt === NETWORK_RETRIES) return result
    lastFailure = result
    } catch (error) {
      const result = { ...item, success: false, elapsedMs: Date.now() - started, linkCount: 0, qualities: [], heights: [], languages: [], manifestChecks: 0, error: error instanceof Error ? error.message : 'Unknown error', servers: [], attemptCount, networkRetried: attempt > 0 }
      if (attempt === NETWORK_RETRIES) return result
      lastFailure = result
    }
    await new Promise(resolve => setTimeout(resolve, RETRY_BACKOFF_MS * (attempt + 1)))
  }
  if (lastFailure) return lastFailure
  try {
    return { ...item, success: false, elapsedMs: Date.now() - started, linkCount: 0, qualities: [], heights: [], languages: [], manifestChecks: 0, error: 'Unknown audit failure', servers: [], attemptCount }
  } catch (error) {
    return { ...item, success: false, elapsedMs: Date.now() - started, linkCount: 0, qualities: [], heights: [], languages: [], manifestChecks: 0, error: error instanceof Error ? error.message : 'Unknown error', servers: [] }
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      out[index] = await fn(items[index], index)
    }
  }))
  return out
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(BASE_URL, { signal: timeout(1000) })
      if (response.ok) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('Development server did not become ready')
}

async function main() {
  const server = USE_EXTERNAL_SERVER
    ? undefined
    : spawn(process.execPath, ['dist/index.js'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      })
  server?.stdout.on('data', chunk => process.stderr.write(chunk))
  server?.stderr.on('data', chunk => process.stderr.write(chunk))
  try {
    await waitForServer()
    const { data } = await fetchJson(`${BASE_URL}/api/v2/providers`, 5000)
    let providers = (data.providers || []).map(item => item.id)
    if (ONLY_PROVIDERS.size) {
      providers = providers.filter(provider => ONLY_PROVIDERS.has(provider))
    }
    console.log(`Auditing ${providers.length} providers with concurrency ${CONCURRENCY}`)
    const providerResults = await mapLimit(providers, CONCURRENCY, async provider => {
      const plan = buildCases(provider)
        .filter(item => !ONLY_MEDIA_IDS.size || ONLY_MEDIA_IDS.has(item.tmdbId))
      const results = []
      for (const item of plan) {
        const result = await testCase(provider, item)
        results.push(result)
        console.log(`${provider}\t${item.type}\t${item.title}\t${result.success ? 'PASS' : 'FAIL'}\t${result.elapsedMs}ms`)
      }
      return { provider, affinity: affinity[provider] || 'general', results }
    })
    await fs.writeFile(OUTPUT, JSON.stringify({
      auditedAt: new Date().toISOString(), methodologyVersion: 2,
      matrixMode: MATRIX_MODE, contentCategories: CONTENT_CATEGORIES,
      cases, providerResults,
    }, null, 2))
    console.log(`Wrote ${OUTPUT}`)
  } finally {
    server?.kill('SIGTERM')
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
