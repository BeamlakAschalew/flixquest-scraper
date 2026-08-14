#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_BASE_URL = 'http://127.0.0.1:3000'
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_CONCURRENCY = 4

export const providerHealthCases = {
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

const providerAffinity = {
  bollyflix: 'indian', netmirror: 'indian', tamilian: 'indian', uhdmovies: 'indian',
  '4khdhub': 'indian', '4khdhubnew': 'indian', movieblast: 'indian', playimdb: 'indian',
  peachify: 'indian', xpass: 'indian', castle: 'indian',
  kisskh: 'korean', dramafull: 'korean', toonhub: 'anime', cuevana: 'spanish',
  notorrent: 'spanish', jetfilmizle: 'turkish', movix: 'french', purstream: 'french',
}

function positiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}

export function buildProviderCases(provider, matrixMode = 'affinity') {
  const categories = matrixMode === 'universal'
    ? Object.keys(providerHealthCases)
    : ['hollywood', providerAffinity[provider] || 'hollywood']
  const uniqueCategories = [...new Set(categories)]

  return uniqueCategories.flatMap(category => {
    const group = providerHealthCases[category]
    return [
      ...group.movies.map(([tmdbId, title]) => ({ type: 'movie', tmdbId, title, category })),
      ...group.tv.map(([tmdbId, season, episode, title]) => ({
        type: 'tv', tmdbId, season, episode, title, category,
      })),
    ]
  })
}

function caseUrl(baseUrl, provider, item) {
  const query = new URLSearchParams({
    tmdbId: item.tmdbId,
    provider,
    proxy: 'false',
    skipCache: 'true',
  })
  if (item.type === 'tv') {
    query.set('season', String(item.season))
    query.set('episode', String(item.episode))
  }
  return `${baseUrl}/api/v2/stream-${item.type === 'tv' ? 'tv' : 'movie'}?${query}`
}

async function checkCase(baseUrl, provider, item, timeoutMs, fetchFn = fetch) {
  const startedAt = Date.now()
  try {
    const response = await fetchFn(caseUrl(baseUrl, provider, item), {
      headers: { 'x-cache-bypass': '1' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await response.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      data = { success: false, error: `Non-JSON HTTP ${response.status}` }
    }
    const linkCount = Array.isArray(data.links) ? data.links.length : 0
    return {
      ...item,
      success: response.ok && data.success === true && linkCount > 0,
      httpStatus: response.status,
      linkCount,
      elapsedMs: Date.now() - startedAt,
      error: data.error || data.details,
    }
  } catch (error) {
    return {
      ...item,
      success: false,
      linkCount: 0,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export async function checkProvider(baseUrl, provider, options = {}) {
  const providerStartedAt = Date.now()
  const timeoutMs = positiveNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS)
  const cases = buildProviderCases(provider, options.matrixMode)
  const attempts = []

  for (const item of cases) {
    const attempt = await checkCase(
      baseUrl,
      provider,
      item,
      timeoutMs,
      options.fetchFn
    )
    attempts.push(attempt)
    if (attempt.success) {
      return {
        provider,
        alias: options.alias || provider,
        status: 'online',
        checkedAt: new Date().toISOString(),
        requestTimeMs: Date.now() - providerStartedAt,
        testedTitles: attempts.length,
        successfulTitle: item,
        linkCount: attempt.linkCount,
        responseTimeMs: attempt.elapsedMs,
        attempts,
      }
    }
  }

  return {
    provider,
    alias: options.alias || provider,
    status: 'offline',
    checkedAt: new Date().toISOString(),
    requestTimeMs: Date.now() - providerStartedAt,
    testedTitles: attempts.length,
    successfulTitle: null,
    linkCount: 0,
    attempts,
  }
}

export async function mapLimit(items, limit, fn) {
  const output = new Array(items.length)
  let cursor = 0
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++
        output[index] = await fn(items[index], index)
      }
    }
  )
  await Promise.all(workers)
  return output
}

async function writeStatusFile(outputFile, status) {
  await fs.mkdir(path.dirname(outputFile), { recursive: true })
  const temporaryFile = `${outputFile}.${process.pid}.tmp`
  await fs.writeFile(temporaryFile, `${JSON.stringify(status, null, 2)}\n`)
  await fs.rename(temporaryFile, outputFile)
}

export async function runProviderHealthCheck(options = {}) {
  const baseUrl = String(options.baseUrl || process.env.PROVIDER_HEALTH_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
  const outputFile = path.resolve(options.outputFile || process.env.PROVIDER_STATUS_FILE || 'data/provider-status.json')
  const concurrency = positiveNumber(options.concurrency || process.env.PROVIDER_HEALTH_CONCURRENCY, DEFAULT_CONCURRENCY)
  const timeoutMs = positiveNumber(options.timeoutMs || process.env.PROVIDER_HEALTH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
  const matrixMode = options.matrixMode || process.env.PROVIDER_HEALTH_MATRIX || 'affinity'
  const startedAt = new Date().toISOString()

  const response = await fetch(`${baseUrl}/api/v2/providers`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Provider list returned HTTP ${response.status}`)
  const data = await response.json()
  const providers = Array.isArray(data.providers)
    ? data.providers.map(item => ({
        id: item.id,
        alias: item.alias || item.name || item.id,
      }))
    : []
  if (!providers.length) throw new Error('The API returned no enabled providers')

  console.log(`[ProviderHealth] Checking ${providers.length} providers with concurrency ${concurrency}`)
  const results = await mapLimit(providers, concurrency, async provider => {
    const result = await checkProvider(baseUrl, provider.id, {
      alias: provider.alias,
      timeoutMs,
      matrixMode,
    })
    console.log(`[ProviderHealth] ${provider.id}: ${result.status} after ${result.testedTitles} title(s)`)
    return result
  })
  const online = results.filter(result => result.status === 'online').length
  const completedAt = new Date().toISOString()
  const status = {
    success: true,
    startedAt,
    updatedAt: completedAt,
    intervalMs: positiveNumber(process.env.PROVIDER_HEALTH_INTERVAL_MS, DEFAULT_INTERVAL_MS),
    methodology: 'Providers run concurrently; each provider tries titles sequentially until one returns a validated stream or its title list is exhausted.',
    summary: { total: results.length, online, offline: results.length - online },
    providers: results.map(result => ({
      id: result.provider,
      alias: result.alias,
      status: result.status,
      requestTimeMs: result.requestTimeMs,
    })),
  }
  await writeStatusFile(outputFile, status)
  console.log(`[ProviderHealth] Wrote ${outputFile}`)
  return status
}

export async function startProviderHealthMonitor(options = {}) {
  const intervalMs = positiveNumber(options.intervalMs || process.env.PROVIDER_HEALTH_INTERVAL_MS, DEFAULT_INTERVAL_MS)
  let running = false

  const run = async () => {
    if (running) {
      console.warn('[ProviderHealth] Previous check is still running; skipping this interval')
      return
    }
    running = true
    try {
      await runProviderHealthCheck(options)
    } catch (error) {
      console.error('[ProviderHealth] Check failed:', error)
    } finally {
      running = false
    }
  }

  await run()
  const timer = setInterval(run, intervalMs)
  return () => clearInterval(timer)
}

const isEntryPoint =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isEntryPoint) {
  const once = process.argv.includes('--once')
  const action = once ? runProviderHealthCheck() : startProviderHealthMonitor()
  action.catch(error => {
    console.error('[ProviderHealth] Fatal error:', error)
    process.exitCode = 1
  })
}
