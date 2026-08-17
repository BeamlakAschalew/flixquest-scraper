#!/usr/bin/env node

import fs from 'node:fs/promises'

const input = process.env.CONTENT_INPUT || '/tmp/flixquest-provider-content-coverage.json'
const reportPath = process.env.REPORT_PATH || 'PROVIDER_RANKING.md'
const content = JSON.parse(await fs.readFile(input, 'utf8'))
let report = await fs.readFile(reportPath, 'utf8')

const categories = content.contentCategories || Object.keys(content.cases || {})
const networkPattern = /timeout|timed out|aborted|fetch failed|econn|enotfound|socket|tls|network|temporarily unavailable|rate limit|cloudflare/i
const isNetwork = result => !result.success && (
  [408, 425, 429, 500, 502, 503, 504].includes(result.httpStatus) || networkPattern.test(String(result.error || ''))
)
const esc = value => String(value ?? '—').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

function categorySummary(results) {
  const inconclusive = results.filter(isNetwork).length
  const eligible = results.filter(result => !isNetwork(result))
  const passed = eligible.filter(result => result.success)
  const movies = passed.filter(result => result.type === 'movie').length
  const tv = passed.filter(result => result.type === 'tv').length
  let label
  if (!eligible.length) label = 'Network-inconclusive'
  else if (!passed.length) label = 'None observed'
  else if (passed.length === results.length && movies >= 2 && tv >= 2) label = 'Strong'
  else if (movies && !tv) label = 'Movies only'
  else if (tv && !movies) label = 'TV only'
  else label = `Partial (${passed.length}/${eligible.length})`
  if (inconclusive && eligible.length) label += ` +${inconclusive} net`
  const heights = [...new Set(passed.flatMap(result => result.heights || []))].sort((a, b) => a - b)
  const qualities = heights.length
    ? heights.map(height => `${height}p`)
    : [...new Set(passed.flatMap(result => result.qualities || []).filter(Boolean))]
  return { label, passed: passed.length, movies, tv, inconclusive, languages: [...new Set(passed.flatMap(result => result.languages || []))].sort(), qualities }
}

const providers = content.providerResults.map(group => {
  const byCategory = new Map()
  for (const category of categories) byCategory.set(category, [])
  for (const result of group.results) byCategory.get(result.category)?.push(result)
  const summaries = Object.fromEntries(categories.map(category => [category, categorySummary(byCategory.get(category) || [])]))
  const strong = categories.filter(category => summaries[category].label === 'Strong')
  const served = categories.filter(category => summaries[category].passed > 0)
  return { provider: group.provider, summaries, strong, served }
})

let section = `## Universal content coverage\n\n`
section += `This second live pass tested every provider against the same **${categories.length} categories × 2 movies × 2 TV episodes** (${content.providerResults.length} providers, ${content.providerResults.length * categories.length * 4} planned calls). It recorded **${content.providerResults.flatMap(group => group.results).filter(result => result.success).length} successful calls**. Network-only failures after retries are marked “net” and are not interpreted as unsupported content.\n\n`
section += `A category marked **Strong** returned both movies and both TV episodes. **Partial** means at least one deterministic success but incomplete coverage. **Movies only** and **TV only** indicate the successful media type. **None observed** means no tested title returned a validated stream; it is not proof that the provider never serves that category.\n\n`
section += `### Category summary\n\n| Provider | Strong categories | Any observed categories | Category details |\n|---|---|---|---|\n`
for (const item of providers) {
  const details = categories.map(category => `${category}: ${item.summaries[category].label}`).join('; ')
  section += `| \`${esc(item.provider)}\` | ${esc(item.strong.join(', ') || 'None')} | ${esc(item.served.join(', ') || 'None')} | ${esc(details)} |\n`
}

section += `\n### Content matrix\n\n`
section += `| Provider | ${categories.join(' | ')} |\n|---|${categories.map(() => '---').join('|')}|\n`
for (const item of providers) {
  section += `| \`${esc(item.provider)}\` | ${categories.map(category => esc(item.summaries[category].label)).join(' | ')} |\n`
}

section += `\n### Audio language and quality by observed category\n\n`
section += `| Provider | Category | Successful cases | Audio languages detected | Qualities observed |\n|---|---|---:|---|---|\n`
for (const item of providers) {
  for (const category of categories) {
    const summary = item.summaries[category]
    if (summary.passed || summary.inconclusive) {
      section += `| \`${esc(item.provider)}\` | ${category} | ${summary.passed} | ${esc(summary.languages.join(', ') || 'Unknown')} | ${esc(summary.qualities.join(', ') || 'None')} |\n`
    }
  }
}

const marker = '## Important limitations'
const existingStart = report.indexOf('## Universal content coverage')
const markerIndex = report.indexOf(marker)
if (existingStart !== -1 && markerIndex > existingStart) {
  report = `${report.slice(0, existingStart)}${report.slice(markerIndex)}`
}
if (report.includes(marker)) report = report.replace(marker, `${section}\n${marker}`)
else report += `\n${section}`
await fs.writeFile(reportPath, report)
console.log(`Updated ${reportPath}`)
