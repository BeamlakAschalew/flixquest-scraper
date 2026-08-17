#!/usr/bin/env node

import fs from 'node:fs/promises'

const primaryPath = process.env.AUDIT_INPUT || '/tmp/flixquest-provider-ranking.json'
const retryPath = process.env.AUDIT_RETRY_INPUT || '/tmp/flixquest-provider-ranking-retry.json'
const outputPath = process.env.AUDIT_REPORT || 'PROVIDER_RANKING.md'
const disableRetryMerge = process.env.AUDIT_DISABLE_RETRY_MERGE === 'true'

const networkPattern = /timeout|timed out|aborted|fetch failed|econn|enotfound|socket|tls|network|temporarily unavailable|rate limit|cloudflare/i

function caseKey(provider, result) {
  return [provider, result.type, result.tmdbId, result.season || '', result.episode || ''].join(':')
}

function isNetworkInconclusive(result) {
  return !result.success && (
    [408, 425, 429, 500, 502, 503, 504].includes(result.httpStatus) ||
    networkPattern.test(String(result.error || ''))
  )
}

function escapeCell(value) {
  return String(value ?? '—').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function languageNames(text) {
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
  return [...found]
}

function resultLanguages(result) {
  return [...new Set([
    ...(result.languages || []),
    ...languageNames([...(result.servers || []), ...(result.qualities || [])].join(' ')),
  ])]
}

function qualityHeight(value) {
  const text = String(value || '')
  if (/\b4k\b|2160/i.test(text)) return 2160
  const values = [...text.matchAll(/(1440|1080|1008|960|872|816|800|720|672|640|582|576|544|540|534|532|480|360|336|320|290|272|266)p?/gi)]
    .map(match => Number(match[1]))
  return values.length ? Math.max(...values) : 0
}

function bestHeight(result) {
  return Math.max(0, ...(result.heights || []), ...(result.qualities || []).map(qualityHeight))
}

function qualityPoints(height) {
  if (height >= 2160) return 25
  if (height >= 1440) return 22
  if (height >= 1080) return 20
  if (height >= 720) return 15
  if (height >= 480) return 8
  if (height > 0) return 5
  return 10
}

function median(values) {
  if (!values.length) return 0
  const ordered = [...values].sort((a, b) => a - b)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2
}

function speedPoints(ms) {
  if (!ms) return 0
  if (ms <= 10000) return 5
  if (ms <= 20000) return 4
  if (ms <= 40000) return 3
  if (ms <= 75000) return 2
  if (ms <= 150000) return 1
  return 0
}

function round(value, digits = 1) {
  return Number(value.toFixed(digits))
}

function compactTitles(results) {
  return results.length ? results.map(result => result.title).join('; ') : '—'
}

const [primaryText, retryText] = await Promise.all([
  fs.readFile(primaryPath, 'utf8'),
  disableRetryMerge ? Promise.resolve(undefined) : fs.readFile(retryPath, 'utf8'),
])
const primary = JSON.parse(primaryText)
const retry = retryText ? JSON.parse(retryText) : { providerResults: [], auditedAt: undefined }

const retryByCase = new Map()
for (const group of retry.providerResults) {
  for (const result of group.results) retryByCase.set(caseKey(group.provider, result), result)
}

const mergedGroups = primary.providerResults.map(group => ({
  ...group,
  results: group.results.map(result => retryByCase.get(caseKey(group.provider, result)) || result),
}))

const summaries = mergedGroups.map(group => {
  const total = group.results.length
  const inconclusive = group.results.filter(isNetworkInconclusive)
  const eligible = group.results.filter(result => !isNetworkInconclusive(result))
  const passed = eligible.filter(result => result.success)
  const failed = eligible.filter(result => !result.success)
  const movieEligible = eligible.filter(result => result.type === 'movie')
  const tvEligible = eligible.filter(result => result.type === 'tv')
  const moviePassed = movieEligible.filter(result => result.success)
  const tvPassed = tvEligible.filter(result => result.success)
  const languages = [...new Set(passed.flatMap(resultLanguages))].sort()
  const heights = [...new Set(passed.flatMap(result => [
    ...(result.heights || []),
    ...(result.qualities || []).map(qualityHeight).filter(Boolean),
  ]))].sort((a, b) => a - b)
  const qualityLabels = [...new Set(passed.flatMap(result => result.qualities || []))]
  const reliability = eligible.length ? (passed.length / eligible.length) * 50 : 0
  const quality = passed.length ? passed.reduce((sum, result) => sum + qualityPoints(bestHeight(result)), 0) / passed.length : 0
  const breadth = (moviePassed.length ? 5 : 0) + (tvPassed.length ? 5 : 0)
  const audio = passed.length ? (passed.filter(result => resultLanguages(result).length).length / passed.length) * 10 : 0
  const medianMs = median(passed.map(result => result.elapsedMs))
  const speed = speedPoints(medianMs)
  const score = round(reliability + quality + breadth + audio + speed)
  const evaluatedRate = total ? eligible.length / total : 0
  const confidence = evaluatedRate === 1 ? 'High' : evaluatedRate >= 0.75 ? 'Medium' : 'Low'
  return {
    ...group, total, eligible, passed, failed, inconclusive, movieEligible, tvEligible,
    moviePassed, tvPassed, languages, heights, qualityLabels, medianMs, score, confidence,
    components: { reliability: round(reliability), quality: round(quality), breadth, audio: round(audio), speed },
  }
})

summaries.sort((a, b) => b.score - a.score || b.passed.length - a.passed.length || a.provider.localeCompare(b.provider))

const allResults = summaries.flatMap(summary => summary.results)
const totalPass = allResults.filter(result => result.success).length
const totalInconclusive = allResults.filter(isNetworkInconclusive).length
const totalDeterministicFail = allResults.length - totalPass - totalInconclusive
const retryRecovered = [...retryByCase.entries()].filter(([key, value]) => value.success && !primary.providerResults
  .flatMap(group => group.results.map(result => [caseKey(group.provider, result), result]))
  .find(([originalKey]) => originalKey === key)?.[1]?.success).length

let md = `# FlixQuest Provider Ranking\n\n`
md += `Live audit performed on **${primary.auditedAt}**${retry.auditedAt ? `, with targeted network retries completed on **${retry.auditedAt}**` : ''}. The audit covered **${summaries.length} registered provider IDs** and **${allResults.length} provider/title calls**. Results: **${totalPass} passed**, **${totalDeterministicFail} produced deterministic no-stream failures**, and **${totalInconclusive} remained network-inconclusive**.${retryRecovered ? ` ${retryRecovered} originally timed-out cases recovered on retry.` : ''}\n\n`
md += `## Ranking\n\n`
md += `| Rank | Provider | Score | Confidence | Passed / evaluated | Movie | TV | Audio languages observed | Video qualities observed | Median successful response |\n`
md += `|---:|---|---:|:---:|---:|---:|---:|---|---|---:|\n`
summaries.forEach((summary, index) => {
  const qualities = summary.heights.length
    ? summary.heights.map(height => `${height}p`).join(', ')
    : summary.qualityLabels.length ? summary.qualityLabels.join(', ') : 'None'
  const cells = [
    index + 1, `\`${summary.provider}\``, summary.score, summary.confidence,
    `${summary.passed.length}/${summary.eligible.length}${summary.inconclusive.length ? ` (+${summary.inconclusive.length} inconclusive)` : ''}`,
    `${summary.moviePassed.length}/${summary.movieEligible.length}`,
    `${summary.tvPassed.length}/${summary.tvEligible.length}`,
    summary.languages.join(', ') || 'Unknown', qualities,
    summary.medianMs ? `${round(summary.medianMs / 1000)}s` : '—',
  ]
  md += `| ${cells.map(escapeCell).join(' | ')} |\n`
})

md += `\n## Scoring method\n\n`
md += `Scores are out of 100 and intentionally separate provider behavior from transient network behavior.\n\n`
md += `- **Reliability — 50 points:** successful cases divided by evaluated cases. Network-inconclusive cases are excluded from the denominator.\n`
md += `- **Video quality — 25 points:** average best observed resolution per successful case (2160p = 25, 1440p = 22, 1080p = 20, 720p = 15, 480p = 8, lower = 5, unresolved Auto = 10).\n`
md += `- **Movie/TV breadth — 10 points:** 5 points for at least one successful movie and 5 for at least one successful TV episode.\n`
md += `- **Audio-language evidence — 10 points:** share of successful cases whose returned server metadata or HLS audio rendition exposed an audio language. “Original audio” was mapped to the title's known original language.\n`
md += `- **Speed — 5 points:** based on median successful API response time: up to 10s = 5, 20s = 4, 40s = 3, 75s = 2, 150s = 1, slower = 0.\n\n`
md += `Confidence describes how much of the planned matrix received a deterministic result: High = 100%, Medium = 75–99%, Low = below 75%. It does not change the score. A provider with unresolved network cases therefore receives a provisional score, not a network penalty.\n\n`

md += `## Test matrix and procedure\n\n`
if (primary.matrixMode === 'universal') {
  md += `Every provider was tested against every category below, using two movies and two TV episodes per category. This produced ${Object.keys(primary.cases).length * 4} identical cases per provider and makes the ranking directly comparable across providers.\n\n`
} else {
  md += `Every provider was tested with two mainstream Hollywood movies and two mainstream Hollywood TV episodes. Region-focused providers also received two movies and two TV episodes from their specialty. This produced four cases for general providers and eight for regional providers.\n\n`
}
for (const [category, matrix] of Object.entries(primary.cases)) {
  const movieNames = matrix.movies.map(item => `${item[1]} (${item[0]})`).join(', ')
  const tvNames = matrix.tv.map(item => `${item[3]} (${item[0]})`).join(', ')
  md += `- **${category[0].toUpperCase()}${category.slice(1)}:** movies — ${movieNames}; TV — ${tvNames}.\n`
}
md += `\nRequests used cache bypassing and raw upstream URLs. Returned links had already passed the API's stream validation. The audit additionally fetched accessible HLS manifests to observe variant resolutions and audio renditions. Requests used a 55-second initial timeout. Network-class failures were retried up to two more times with backoff and a 90-second per-attempt timeout. HTTP 404 “no streams found” responses were treated as deterministic failures rather than retried as network errors.\n\n`
md += `Audio language is reported only when detectable from returned stream/server metadata or an HLS audio rendition. “Unknown” does not prove that a stream has no audio track; it means the provider did not expose reliable language evidence through the audited response. Quality is the maximum variant or explicit quality label observed, not a full-playback bitrate/codec assessment.\n\n`

md += `## Provider details\n\n`
for (const [index, summary] of summaries.entries()) {
  md += `### ${index + 1}. ${summary.provider} — ${summary.score}/100\n\n`
  md += `Score components: reliability ${summary.components.reliability}/50, quality ${summary.components.quality}/25, movie/TV breadth ${summary.components.breadth}/10, audio-language evidence ${summary.components.audio}/10, speed ${summary.components.speed}/5. Confidence: **${summary.confidence}**.\n\n`
  md += `| Result | Titles |\n|---|---|\n`
  md += `| Successful | ${escapeCell(compactTitles(summary.passed))} |\n`
  md += `| Deterministic failure | ${escapeCell(compactTitles(summary.failed))} |\n`
  md += `| Network-inconclusive | ${escapeCell(compactTitles(summary.inconclusive))} |\n\n`
  const languageText = summary.languages.join(', ') || 'Unknown / not exposed'
  const qualityText = summary.qualityLabels.join(', ') || 'None observed'
  md += `Observed audio languages: **${languageText}**. Declared quality labels: **${qualityText}**.`
  if (summary.heights.length) md += ` Parsed resolutions: **${summary.heights.map(height => `${height}p`).join(', ')}**.`
  md += `\n\n`
}

md += `## Important limitations\n\n`
md += `This is a point-in-time audit from one network location. Provider catalogs, tokens, anti-bot protections, geo-blocking, and stream URLs change frequently. A successful result means at least one validated link was returned; it does not certify uninterrupted full-length playback. A deterministic no-stream result means the provider returned no validated stream for the tested title at audit time, not that its entire catalog is permanently unavailable.\n`

await fs.writeFile(outputPath, md)
console.log(`Wrote ${outputPath}`)
