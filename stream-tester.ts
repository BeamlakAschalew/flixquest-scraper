/**
 * Stream Tester — hits every registered provider with appropriate TMDB IDs.
 *
 * Usage:
 *   tsx stream-tester.ts                        # test all providers
 *   tsx stream-tester.ts --provider vixsrc       # test one provider
 *   tsx stream-tester.ts --provider vixsrc,cineby # test multiple
 *   tsx stream-tester.ts --base-url http://localhost:4000  # custom base
 *   tsx stream-tester.ts --timeout 30000         # custom timeout (ms)
 *   tsx stream-tester.ts --concurrency 3         # parallel provider limit
 *   tsx stream-tester.ts --proxy false           # disable proxy rewrites
 *
 * Requires the server to be running. Start it with: pnpm dev
 */

import 'dotenv/config'

// ─── Configuration ──────────────────────────────────────────────────────────

const args = process.argv.slice(2)
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`)
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined
}

const BASE_URL = getArg('base-url') || 'http://localhost:3000'
const TIMEOUT_MS = parseInt(getArg('timeout') || '45000', 10)
const CONCURRENCY = parseInt(getArg('concurrency') || '5', 10)
const PROXY = getArg('proxy') ?? 'false'
const ONLY_PROVIDERS = getArg('provider')
  ?.split(',')
  .map(s => s.trim())
  .filter(Boolean)

// ─── TMDB Test IDs ──────────────────────────────────────────────────────────
//
// Each entry provides a well-known title so it's easy to verify results.
// Movies and TV shows are separated. Region-specific content is grouped so
// providers that specialize in certain catalogs get content they'll actually
// find.

interface TestMovie {
  tmdbId: string
  title: string
  tags: string[] // e.g. ['hollywood','popular'], ['bollywood'], etc.
}

interface TestShow {
  tmdbId: string
  title: string
  season: number
  episode: number
  tags: string[]
}

// ── Movies ───────────────────────────────────────────────────────────────

const MOVIES: TestMovie[] = [
  // Hollywood / General
  { tmdbId: '278', title: 'The Shawshank Redemption', tags: ['hollywood', 'popular'] },
  { tmdbId: '550', title: 'Fight Club', tags: ['hollywood', 'popular'] },
  { tmdbId: '27205', title: 'Inception', tags: ['hollywood', 'popular'] },
  { tmdbId: '155', title: 'The Dark Knight', tags: ['hollywood', 'popular'] },
  { tmdbId: '157336', title: 'Interstellar', tags: ['hollywood', 'popular'] },
  { tmdbId: '299536', title: 'Avengers: Infinity War', tags: ['hollywood', 'popular'] },
  { tmdbId: '603', title: 'The Matrix', tags: ['hollywood', 'popular'] },
  { tmdbId: '556574', title: 'Hamilton', tags: ['hollywood'] },

  // Bollywood / Indian
  { tmdbId: '19404', title: '3 Idiots', tags: ['bollywood', 'indian'] },
  { tmdbId: '20453', title: 'Lagaan', tags: ['bollywood', 'indian'] },
  { tmdbId: '614933', title: 'KGF: Chapter 2', tags: ['bollywood', 'indian'] },
  { tmdbId: '439079', title: 'Dangal', tags: ['bollywood', 'indian'] },
  { tmdbId: '348350', title: 'Baahubali 2: The Conclusion', tags: ['bollywood', 'indian'] },
  { tmdbId: '961268', title: 'Jawan', tags: ['bollywood', 'indian'] },
  { tmdbId: '1011985', title: 'Kung Fu Panda 4', tags: ['hollywood', 'popular'] },

  // Korean
  { tmdbId: '496243', title: 'Parasite', tags: ['korean', 'asian'] },
  { tmdbId: '677179', title: 'Escape from Mogadishu', tags: ['korean', 'asian'] },
  { tmdbId: '800158', title: 'The Gangster, the Cop, the Devil', tags: ['korean', 'asian'] },

  // Japanese / Anime Movies
  { tmdbId: '372058', title: 'Your Name', tags: ['anime', 'japanese', 'asian'] },
  { tmdbId: '129', title: 'Spirited Away', tags: ['anime', 'japanese', 'asian'] },
  { tmdbId: '508883', title: 'Dragon Ball Super: Broly', tags: ['anime', 'japanese'] },
  { tmdbId: '635302', title: 'Demon Slayer: Mugen Train', tags: ['anime', 'japanese', 'asian'] },

  // Chinese
  { tmdbId: '346364', title: 'It\'s a Mad, Mad, Mad, Mad World (2016)', tags: ['chinese', 'asian'] },

  // Turkish
  { tmdbId: '65754', title: 'Recep Ivedik', tags: ['turkish'] },
  { tmdbId: '464111', title: 'Miracle in Cell No. 7 (2019 Turkish)', tags: ['turkish'] },

  // Spanish / Latin
  { tmdbId: '17473', title: 'El Secreto de Sus Ojos', tags: ['spanish', 'latin'] },
  { tmdbId: '1690', title: 'Pan\'s Labyrinth', tags: ['spanish'] },
  { tmdbId: '11338', title: 'Y Tu Mamá También', tags: ['spanish', 'latin'] },

  // Animation / Cartoon Movies
  { tmdbId: '862', title: 'Toy Story', tags: ['animation', 'cartoon', 'hollywood'] },
  { tmdbId: '150540', title: 'Inside Out', tags: ['animation', 'cartoon', 'hollywood'] },

  // French
  { tmdbId: '194', title: 'Amélie', tags: ['french'] },
  { tmdbId: '11216', title: 'The Intouchables', tags: ['french'] },

  // Arabic / Middle Eastern
  { tmdbId: '872585', title: 'Oppenheimer', tags: ['arabic', 'hollywood', 'popular'] },
  { tmdbId: '579974', title: 'RRR', tags: ['indian', 'bollywood', 'arabic'] },
  { tmdbId: '949229', title: 'Leo', tags: ['indian', 'bollywood'] },
]

// ── TV Shows ─────────────────────────────────────────────────────────────

const TV_SHOWS: TestShow[] = [
  // Hollywood / General
  { tmdbId: '1396', title: 'Breaking Bad', season: 1, episode: 1, tags: ['hollywood', 'popular'] },
  { tmdbId: '1399', title: 'Game of Thrones', season: 1, episode: 1, tags: ['hollywood', 'popular'] },
  { tmdbId: '2316', title: 'The Office (US)', season: 1, episode: 1, tags: ['hollywood', 'popular'] },
  { tmdbId: '66732', title: 'Stranger Things', season: 1, episode: 1, tags: ['hollywood', 'popular'] },
  { tmdbId: '82856', title: 'The Mandalorian', season: 1, episode: 1, tags: ['hollywood', 'popular'] },
  { tmdbId: '94997', title: 'House of the Dragon', season: 1, episode: 1, tags: ['hollywood', 'popular'] },
  { tmdbId: '76479', title: 'The Boys', season: 1, episode: 1, tags: ['hollywood', 'popular'] },

  // Korean Drama
  { tmdbId: '100088', title: 'All of Us Are Dead', season: 1, episode: 1, tags: ['korean', 'asian', 'kdrama'] },
  { tmdbId: '93405', title: 'Squid Game', season: 1, episode: 1, tags: ['korean', 'asian', 'kdrama'] },
  { tmdbId: '67915', title: 'Goblin', season: 1, episode: 1, tags: ['korean', 'asian', 'kdrama'] },
  { tmdbId: '110316', title: 'Alchemy of Souls', season: 1, episode: 1, tags: ['korean', 'asian', 'kdrama'] },
  { tmdbId: '96316', title: 'Crash Landing on You', season: 1, episode: 1, tags: ['korean', 'asian', 'kdrama'] },

  // Japanese Drama / Asian
  { tmdbId: '83095', title: 'Alice in Borderland', season: 1, episode: 1, tags: ['japanese', 'asian'] },

  // Chinese Drama
  { tmdbId: '91759', title: 'Word of Honor', season: 1, episode: 1, tags: ['chinese', 'asian', 'cdrama'] },

  // Indian TV
  { tmdbId: '79744', title: 'Sacred Games', season: 1, episode: 1, tags: ['indian', 'bollywood'] },
  { tmdbId: '121750', title: 'The Family Man', season: 1, episode: 1, tags: ['indian', 'bollywood'] },

  // Turkish
  { tmdbId: '75219', title: 'Diriliş: Ertuğrul', season: 1, episode: 1, tags: ['turkish'] },

  // Spanish / Latin
  { tmdbId: '71446', title: 'Money Heist (La Casa de Papel)', season: 1, episode: 1, tags: ['spanish', 'latin', 'popular'] },
  { tmdbId: '73021', title: 'Cable Girls (Las Chicas del Cable)', season: 1, episode: 1, tags: ['spanish', 'latin'] },

  // Anime Series
  { tmdbId: '85937', title: 'Demon Slayer', season: 1, episode: 1, tags: ['anime', 'japanese'] },
  { tmdbId: '46260', title: 'Naruto', season: 1, episode: 1, tags: ['anime', 'japanese'] },
  { tmdbId: '37854', title: 'One Piece', season: 1, episode: 1, tags: ['anime', 'japanese'] },
  { tmdbId: '31911', title: 'Dragon Ball Z', season: 1, episode: 1, tags: ['anime', 'japanese'] },
  { tmdbId: '95557', title: 'Jujutsu Kaisen', season: 1, episode: 1, tags: ['anime', 'japanese'] },
  { tmdbId: '1429', title: 'Attack on Titan', season: 1, episode: 1, tags: ['anime', 'japanese'] },

  // Animation / Cartoon Series
  { tmdbId: '246', title: 'Avatar: The Last Airbender', season: 1, episode: 1, tags: ['cartoon', 'animation'] },
  { tmdbId: '456', title: 'The Simpsons', season: 1, episode: 1, tags: ['cartoon', 'animation'] },
  { tmdbId: '60625', title: 'Rick and Morty', season: 1, episode: 1, tags: ['cartoon', 'animation'] },

  // French
  { tmdbId: '1418', title: 'The Big Bang Theory', season: 1, episode: 1, tags: ['french', 'hollywood', 'popular'] },

  // Arabic / International
  { tmdbId: '215720', title: 'Queen of Tears', season: 1, episode: 1, tags: ['korean', 'asian', 'kdrama', 'arabic'] },
]

// ─── Provider → Content Mapping ─────────────────────────────────────────
//
// Maps each provider to the tags it is most likely to serve. Providers with
// no entry here get tested with the generic 'hollywood/popular' set.

const PROVIDER_TAG_AFFINITY: Record<string, string[]> = {
  // Indian / Bollywood
  bollyflix:      ['bollywood', 'indian'],
  netmirror:     ['bollywood', 'indian', 'hollywood'],
  tamilian:      ['bollywood', 'indian'],
  uhdmovies:     ['bollywood', 'indian', 'hollywood'],
  '4khdhub':     ['bollywood', 'indian', 'hollywood'],
  '4khdhubnew':  ['bollywood', 'indian', 'hollywood'],
  movieblast:    ['bollywood', 'indian', 'hollywood'],

  // Korean / Asian Drama
  kisskh:        ['korean', 'asian', 'kdrama', 'cdrama', 'japanese'],
  dramafull:     ['korean', 'asian', 'kdrama', 'cdrama'],

  // Anime / Cartoons
  toonhub:       ['anime', 'cartoon', 'animation'],

  // Spanish / Latin
  cuevana:       ['spanish', 'latin', 'hollywood'],

  // Turkish
  jetfilmizle:   ['turkish', 'hollywood'],

  // Spanish + English
  notorrent:     ['spanish', 'latin', 'hollywood', 'popular'],

  // French
  movix:         ['french', 'hollywood', 'popular'],
  purstream:     ['french', 'hollywood', 'popular'],

  // Arabic / International
  cineby:        ['arabic', 'hollywood', 'popular'],

  // Indian (broader)
  playimdb:      ['bollywood', 'indian', 'hollywood'],
  peachify:      ['bollywood', 'indian', 'hollywood'],
  xpass:         ['bollywood', 'indian', 'hollywood'],

  // General providers — test with popular/hollywood
  vixsrc:        ['hollywood', 'popular'],
  vidsrc:        ['hollywood', 'popular'],
  vidzee:        ['hollywood', 'popular'],
  showbox:       ['hollywood', 'popular'],
  dahmermovies:  ['hollywood', 'popular'],
  'dahmermovies-tv': ['hollywood', 'popular'],
  streamflix:    ['hollywood', 'popular'],
  videasy:       ['hollywood', 'popular'],
  videasy2:      ['hollywood', 'popular'],
  vidlink:       ['hollywood', 'popular'],
  vidfast:       ['hollywood', 'popular'],
  castle:        ['hollywood', 'popular'],
  artemis:       ['hollywood', 'popular'],
  watchflux:     ['hollywood', 'popular'],
  aether:        ['hollywood', 'popular'],
}

// ─── Helpers ────────────────────────────────────────────────────────────

function pickMovies(tags: string[], max = 3): TestMovie[] {
  const matched = MOVIES.filter(m => m.tags.some(t => tags.includes(t)))
  // Shuffle deterministically and take up to `max`
  return matched.slice(0, max)
}

function pickShows(tags: string[], max = 2): TestShow[] {
  const matched = TV_SHOWS.filter(s => s.tags.some(t => tags.includes(t)))
  return matched.slice(0, max)
}

// ─── Types ──────────────────────────────────────────────────────────────

interface TestResult {
  provider: string
  type: 'movie' | 'tv'
  title: string
  tmdbId: string
  season?: number
  episode?: number
  success: boolean
  linkCount: number
  qualities: string[]
  hasSubtitles: boolean
  timeMs: number
  error?: string
  httpStatus?: number
}

// ─── Colors ─────────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
}

// ─── Core Test Functions ────────────────────────────────────────────────

async function testMovieStream(
  provider: string,
  movie: TestMovie
): Promise<TestResult> {
  const url = `${BASE_URL}/api/v2/stream-movie?tmdbId=${movie.tmdbId}&provider=${provider}&proxy=${PROXY}`
  const start = performance.now()

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    const data = await res.json()
    const timeMs = Math.round(performance.now() - start)

    if (data.success && data.links?.length > 0) {
      return {
        provider,
        type: 'movie',
        title: movie.title,
        tmdbId: movie.tmdbId,
        success: true,
        linkCount: data.links.length,
        qualities: data.links.map((l: any) => l.quality),
        hasSubtitles: data.links.some((l: any) => l.subtitles?.length > 0),
        timeMs,
        httpStatus: res.status,
      }
    }

    return {
      provider,
      type: 'movie',
      title: movie.title,
      tmdbId: movie.tmdbId,
      success: false,
      linkCount: 0,
      qualities: [],
      hasSubtitles: false,
      timeMs,
      error: data.error || 'No streams returned',
      httpStatus: res.status,
    }
  } catch (err) {
    return {
      provider,
      type: 'movie',
      title: movie.title,
      tmdbId: movie.tmdbId,
      success: false,
      linkCount: 0,
      qualities: [],
      hasSubtitles: false,
      timeMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

async function testTVStream(
  provider: string,
  show: TestShow
): Promise<TestResult> {
  const url = `${BASE_URL}/api/v2/stream-tv?tmdbId=${show.tmdbId}&season=${show.season}&episode=${show.episode}&provider=${provider}&proxy=${PROXY}`
  const start = performance.now()

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    const data = await res.json()
    const timeMs = Math.round(performance.now() - start)

    if (data.success && data.links?.length > 0) {
      return {
        provider,
        type: 'tv',
        title: `${show.title} S${show.season}E${show.episode}`,
        tmdbId: show.tmdbId,
        season: show.season,
        episode: show.episode,
        success: true,
        linkCount: data.links.length,
        qualities: data.links.map((l: any) => l.quality),
        hasSubtitles: data.links.some((l: any) => l.subtitles?.length > 0),
        timeMs,
        httpStatus: res.status,
      }
    }

    return {
      provider,
      type: 'tv',
      title: `${show.title} S${show.season}E${show.episode}`,
      tmdbId: show.tmdbId,
      season: show.season,
      episode: show.episode,
      success: false,
      linkCount: 0,
      qualities: [],
      hasSubtitles: false,
      timeMs,
      error: data.error || 'No streams returned',
      httpStatus: res.status,
    }
  } catch (err) {
    return {
      provider,
      type: 'tv',
      title: `${show.title} S${show.season}E${show.episode}`,
      tmdbId: show.tmdbId,
      season: show.season,
      episode: show.episode,
      success: false,
      linkCount: 0,
      qualities: [],
      hasSubtitles: false,
      timeMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

// ─── Concurrency Limiter ────────────────────────────────────────────────

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  let idx = 0

  async function worker() {
    while (idx < items.length) {
      const i = idx++
      results[i] = await fn(items[i])
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker()
  )
  await Promise.all(workers)
  return results
}

// ─── Display Helpers ────────────────────────────────────────────────────

function statusBadge(success: boolean): string {
  return success
    ? `${c.bgGreen}${c.bold} PASS ${c.reset}`
    : `${c.bgRed}${c.bold} FAIL ${c.reset}`
}

function pad(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length)
}

function printResultLine(r: TestResult) {
  const badge = statusBadge(r.success)
  const type = r.type === 'movie' ? `${c.blue}🎬 MOV${c.reset}` : `${c.magenta}📺 TV ${c.reset}`
  const links = r.success
    ? `${c.green}${r.linkCount} link(s)${c.reset}`
    : `${c.red}0 links${c.reset}`
  const quals = r.qualities.length
    ? `${c.cyan}[${r.qualities.join(', ')}]${c.reset}`
    : `${c.dim}—${c.reset}`
  const subs = r.hasSubtitles ? `${c.yellow}🗨 subs${c.reset}` : `${c.dim}no subs${c.reset}`
  const time = `${c.dim}${r.timeMs}ms${c.reset}`
  const err = r.error ? `  ${c.red}↳ ${r.error}${c.reset}` : ''

  console.log(
    `  ${badge} ${type} ${pad(r.title, 42)} ${pad(links, 18)} ${pad(quals, 30)} ${subs}  ${time}${err}`
  )
}

// ─── Summary Table ──────────────────────────────────────────────────────

interface ProviderSummary {
  provider: string
  totalTests: number
  passed: number
  failed: number
  moviePassed: number
  movieTotal: number
  tvPassed: number
  tvTotal: number
  avgTimeMs: number
  hasSubtitles: boolean
}

function printSummary(results: TestResult[]) {
  const byProvider = new Map<string, TestResult[]>()
  for (const r of results) {
    if (!byProvider.has(r.provider)) byProvider.set(r.provider, [])
    byProvider.get(r.provider)!.push(r)
  }

  const summaries: ProviderSummary[] = []
  for (const [provider, pResults] of byProvider) {
    const movieResults = pResults.filter(r => r.type === 'movie')
    const tvResults = pResults.filter(r => r.type === 'tv')
    summaries.push({
      provider,
      totalTests: pResults.length,
      passed: pResults.filter(r => r.success).length,
      failed: pResults.filter(r => !r.success).length,
      moviePassed: movieResults.filter(r => r.success).length,
      movieTotal: movieResults.length,
      tvPassed: tvResults.filter(r => r.success).length,
      tvTotal: tvResults.length,
      avgTimeMs: Math.round(
        pResults.reduce((sum, r) => sum + r.timeMs, 0) / pResults.length
      ),
      hasSubtitles: pResults.some(r => r.hasSubtitles),
    })
  }

  // Sort: fully passing first, then by pass rate descending
  summaries.sort((a, b) => {
    const rateA = a.passed / a.totalTests
    const rateB = b.passed / b.totalTests
    if (rateA !== rateB) return rateB - rateA
    return a.provider.localeCompare(b.provider)
  })

  console.log(`\n${c.bold}${'═'.repeat(110)}${c.reset}`)
  console.log(`${c.bold}${c.cyan}  PROVIDER SUMMARY${c.reset}`)
  console.log(`${c.bold}${'═'.repeat(110)}${c.reset}`)

  const hdr = `  ${pad('Provider', 20)} ${pad('Status', 10)} ${pad('Pass Rate', 12)} ${pad('Movies', 12)} ${pad('TV', 12)} ${pad('Avg Time', 10)} ${pad('Subs', 6)}`
  console.log(`${c.bold}${hdr}${c.reset}`)
  console.log(`  ${'─'.repeat(106)}`)

  for (const s of summaries) {
    const rate = s.totalTests > 0 ? (s.passed / s.totalTests) * 100 : 0
    const rateStr = `${rate.toFixed(0)}%`
    const statusColor = rate === 100 ? c.green : rate > 0 ? c.yellow : c.red
    const status = rate === 100 ? '✅ UP' : rate > 0 ? '⚠️  PARTIAL' : '❌ DOWN'
    const subs = s.hasSubtitles ? '✓' : '—'

    console.log(
      `  ${pad(s.provider, 20)} ${statusColor}${pad(status, 10)}${c.reset} ${statusColor}${pad(rateStr, 12)}${c.reset} ${pad(`${s.moviePassed}/${s.movieTotal}`, 12)} ${pad(`${s.tvPassed}/${s.tvTotal}`, 12)} ${c.dim}${pad(`${s.avgTimeMs}ms`, 10)}${c.reset} ${pad(subs, 6)}`
    )
  }

  console.log(`  ${'─'.repeat(106)}`)

  const totalPassed = results.filter(r => r.success).length
  const totalFailed = results.filter(r => !r.success).length
  const overallRate = results.length > 0 ? ((totalPassed / results.length) * 100).toFixed(1) : '0'
  const providersUp = summaries.filter(s => s.passed > 0).length
  const providersDown = summaries.filter(s => s.passed === 0).length

  console.log(`\n  ${c.bold}Total:${c.reset} ${results.length} tests across ${summaries.length} providers`)
  console.log(`  ${c.green}Passed: ${totalPassed}${c.reset}  ${c.red}Failed: ${totalFailed}${c.reset}  ${c.cyan}Rate: ${overallRate}%${c.reset}`)
  console.log(`  ${c.green}Providers responding: ${providersUp}${c.reset}  ${c.red}Providers down: ${providersDown}${c.reset}`)
  console.log()
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${c.bold}${c.cyan}╔${'═'.repeat(58)}╗${c.reset}`)
  console.log(`${c.bold}${c.cyan}║  🧪  FlixQuest Stream Tester                             ║${c.reset}`)
  console.log(`${c.bold}${c.cyan}╚${'═'.repeat(58)}╝${c.reset}\n`)

  console.log(`${c.dim}  Base URL:    ${BASE_URL}`)
  console.log(`  Timeout:     ${TIMEOUT_MS}ms`)
  console.log(`  Concurrency: ${CONCURRENCY}`)
  console.log(`  Proxy:       ${PROXY}${c.reset}\n`)

  // 1. Check if server is running
  console.log(`${c.dim}Checking server connectivity...${c.reset}`)
  try {
    const healthRes = await fetch(BASE_URL, {
      signal: AbortSignal.timeout(5000),
    })
    if (!healthRes.ok) throw new Error(`HTTP ${healthRes.status}`)
    console.log(`${c.green}✓ Server is running at ${BASE_URL}${c.reset}\n`)
  } catch (err) {
    console.error(
      `${c.red}✗ Cannot reach server at ${BASE_URL}${c.reset}`
    )
    console.error(
      `${c.dim}  Make sure the server is running (pnpm dev)${c.reset}\n`
    )
    process.exit(1)
  }

  // 2. Fetch provider list from the API
  let providerIds: string[]
  try {
    const provRes = await fetch(`${BASE_URL}/api/v2/providers`, {
      signal: AbortSignal.timeout(5000),
    })
    const provData = await provRes.json()
    providerIds = (provData.providers || []).map((p: any) => p.id)
    console.log(
      `${c.dim}Discovered ${providerIds.length} providers: ${providerIds.join(', ')}${c.reset}\n`
    )
  } catch {
    console.error(
      `${c.red}✗ Failed to fetch provider list from /api/v2/providers${c.reset}`
    )
    process.exit(1)
  }

  // 3. Filter if --provider flag is set
  if (ONLY_PROVIDERS) {
    const invalid = ONLY_PROVIDERS.filter(p => !providerIds.includes(p))
    if (invalid.length) {
      console.error(
        `${c.red}✗ Unknown provider(s): ${invalid.join(', ')}${c.reset}`
      )
      console.error(
        `${c.dim}  Available: ${providerIds.join(', ')}${c.reset}`
      )
      process.exit(1)
    }
    providerIds = ONLY_PROVIDERS
    console.log(
      `${c.yellow}Filtered to ${providerIds.length} provider(s): ${providerIds.join(', ')}${c.reset}\n`
    )
  }

  // 4. Build test plan
  interface ProviderTestPlan {
    provider: string
    movies: TestMovie[]
    shows: TestShow[]
  }

  const testPlan: ProviderTestPlan[] = providerIds.map(pid => {
    const tags = PROVIDER_TAG_AFFINITY[pid] || ['hollywood', 'popular']
    return {
      provider: pid,
      movies: pickMovies(tags),
      shows: pickShows(tags),
    }
  })

  const totalTests = testPlan.reduce(
    (sum, p) => sum + p.movies.length + p.shows.length,
    0
  )
  console.log(
    `${c.bold}Running ${totalTests} tests across ${providerIds.length} providers (concurrency=${CONCURRENCY})${c.reset}\n`
  )

  // 5. Execute tests with concurrency limiting at the provider level
  const allResults: TestResult[] = []
  const startTime = performance.now()

  await mapWithConcurrency(testPlan, CONCURRENCY, async plan => {
    console.log(
      `${c.bold}${c.cyan}┌─ ${plan.provider} ${c.reset}${c.dim}(${plan.movies.length} movies, ${plan.shows.length} shows)${c.reset}`
    )

    // Run movie tests sequentially within a provider to avoid overwhelming it
    for (const movie of plan.movies) {
      const result = await testMovieStream(plan.provider, movie)
      allResults.push(result)
      printResultLine(result)
    }

    // Run TV tests
    for (const show of plan.shows) {
      const result = await testTVStream(plan.provider, show)
      allResults.push(result)
      printResultLine(result)
    }

    const provResults = allResults.filter(r => r.provider === plan.provider)
    const passed = provResults.filter(r => r.success).length
    const total = provResults.length
    const icon = passed === total ? '✅' : passed > 0 ? '⚠️' : '❌'
    console.log(
      `${c.bold}${c.cyan}└─ ${plan.provider}${c.reset} ${icon} ${passed}/${total} passed\n`
    )
  })

  const totalTime = Math.round(performance.now() - startTime)

  // 6. Print summary
  printSummary(allResults)
  console.log(`${c.dim}  Total execution time: ${(totalTime / 1000).toFixed(1)}s${c.reset}\n`)
}

main().catch(err => {
  console.error(`${c.red}Fatal error:${c.reset}`, err)
  process.exit(1)
})
