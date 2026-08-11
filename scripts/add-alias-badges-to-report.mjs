#!/usr/bin/env node

import fs from 'node:fs/promises'

const reportPath = process.env.REPORT_PATH || 'PROVIDER_RANKING.md'
const { getAllProviders } = await import('../dist/providers/index.js')
let report = await fs.readFile(reportPath, 'utf8')

let section = `## API aliases and content\n\n`
section += `The API exposes short provider names in \`alias\` and the audited content/audio pairs separately in \`content\`. Content is ordered as **Hollywood, Indian/Bollywood, Korean, anime, Turkish, Spanish, French, animation**. Each pair is **content-origin flag / observed audio-language flag(s)**. `
section += `For example, an alias of \`Axum\` with content \`Hollywood: English | Indian/Bollywood: Hindi\` clearly identifies both the served category and observed audio language. \`audio unknown\` means the stream worked but reliable audio metadata was not exposed; an empty value means no validated category result was observed.\n\n`
section += `| Provider | API alias | Content |\n|---|---|---|\n`
for (const provider of getAllProviders()) {
  const alias = String(provider.alias || provider.name).replace(/\|/g, '\\|')
  const content = String(provider.content || '').replace(/\|/g, '\\|')
  section += `| \`${provider.id}\` | ${alias} | ${content} |\n`
}
section += `\n`

const marker = '## Scoring method'
const oldStart = report.indexOf('## API alias badges')
const newStart = report.indexOf('## API aliases and content')
const start = oldStart === -1 ? newStart : oldStart
const markerIndex = report.indexOf(marker)
if (start !== -1 && markerIndex > start)
  report = `${report.slice(0, start)}${report.slice(markerIndex)}`
report = report.replace(marker, `${section}${marker}`)
await fs.writeFile(reportPath, report)
console.log(`Updated ${reportPath}`)
