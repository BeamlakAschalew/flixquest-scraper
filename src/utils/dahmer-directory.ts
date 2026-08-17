import * as cheerio from 'cheerio'

const DAHMER_TV_ROOT = 'https://a.111477.xyz/tvs/'
const CACHE_TTL_MS = 4 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 20_000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

interface DirectoryEntry {
  name: string
  path: string
}

let cache: { entries: DirectoryEntry[]; timestamp: number } | undefined

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

async function getEntries(): Promise<DirectoryEntry[]> {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return cache.entries
  }

  const response = await fetch(DAHMER_TV_ROOT, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Dahmer TV index HTTP ${response.status}`)

  const $ = cheerio.load(await response.text())
  const entries: DirectoryEntry[] = []
  $('[data-entry="true"][data-url]').each((_index, element) => {
    const path = $(element).attr('data-url')
    const name = $(element).attr('data-name') || $('a', element).first().text()
    if (path?.startsWith('/tvs/') && name) entries.push({ name, path })
  })
  cache = { entries, timestamp: Date.now() }
  return entries
}

export async function findDahmerShowDirectories(
  title: string,
  year: string,
  country?: string
): Promise<string[]> {
  const target = normalize(title)
  const countryLabel = country === 'GB' ? 'UK' : country
  const desired = new Set(
    [title, `${title} ${year}`, countryLabel ? `${title} ${countryLabel}` : '']
      .filter(Boolean)
      .map(normalize)
  )

  try {
    const ranked = (await getEntries())
      .map(entry => {
        const full = normalize(entry.name)
        const base = normalize(entry.name.replace(/\s*\([^)]*\)\s*$/, ''))
        let score = desired.has(full) ? 100 : base === target ? 70 : 0
        if (countryLabel && full === normalize(`${title} ${countryLabel}`)) {
          score += 50
        }
        if (year && full === normalize(`${title} ${year}`)) score += 30
        return { ...entry, score }
      })
      .filter(entry => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 6)
      .map(entry => entry.path)
    if (ranked.length > 0) return ranked
  } catch {
    // Fall through to deterministic title variants if the large index is down.
  }

  const cleanTitle = title.replace(/:/g, '')
  return Array.from(
    new Set([
      ...(countryLabel ? [`${cleanTitle} (${countryLabel})`] : []),
      ...(year ? [`${cleanTitle} (${year})`] : []),
      cleanTitle,
      title.replace(/:/g, ' -'),
    ])
  ).map(candidate => `/tvs/${encodeURIComponent(candidate)}/`)
}
