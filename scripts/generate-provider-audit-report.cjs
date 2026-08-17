#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { groups, homepages, languageOverrides, origins, priorityOverrides } = require('./provider-catalog-data.cjs');

const input = process.argv[2] || '/tmp/nuvio-provider-audit-results.json';
const data = JSON.parse(fs.readFileSync(input, 'utf8'));
const webInput = process.argv[3] || '/tmp/webstreamr-audit-results-v4.json';
const webData = JSON.parse(fs.readFileSync(webInput, 'utf8'));

const statusIcon = {
  working: '✅ Working',
  no_match: '⚠️ No tested match',
  broken: '❌ Broken',
  incompatible: '❌ Incompatible interface',
};

function classify(provider) {
  if (provider.loadIssue) return 'broken';
  if (provider.repo === 'nuvio-providers' && provider.id === 'myflixer-extractor') return 'broken';
  if (provider.repo === 'nuviotr' && provider.id === 'orphan-m3u-list') return 'incompatible';
  if (provider.tests.some((test) => test.status === 'returned_streams')) return 'working';
  return 'no_match';
}

function evidence(provider, status) {
  if (provider.loadIssue) return `Manifest target \`${provider.filename}\` does not exist.`;
  if (provider.repo === 'nuvio-providers' && provider.id === 'myflixer-extractor') {
    return 'Manifest points at an extractor-only file; no `getStreams` export after compatibility rerun.';
  }
  if (provider.repo === 'nuviotr' && provider.id === 'orphan-m3u-list') {
    return 'Unregistered script returned a non-array/undefined result for all four Turkish cases.';
  }
  if (status === 'working') {
    const test = provider.tests.find((item) => item.status === 'returned_streams');
    const disabled = provider.enabled === false ? ' Manifest-disabled, but callable.' : '';
    const unregistered = provider.registered === false ? ' Unregistered file.' : '';
    return `${test.label} (TMDB ${test.id}, ${test.mediaType}) returned ${test.count} stream${test.count === 1 ? '' : 's'}.${disabled}${unregistered}`;
  }
  if (provider.repo === 'NuvioRepo' && provider.id === 'xdmovies') {
    return 'Compatibility rerun loaded correctly but returned 0 for TMDB 949229, 200861, 579974, and 79352 (some endpoint timeouts).';
  }
  if (provider.repo === 'All-in-One-Nuvio' && ['Cineby', 'cinemacity', 'gramcinema'].includes(provider.id)) {
    const extra = provider.id === 'gramcinema' ? ' GramCinema also requires its own settings token.' : '';
    return `0 streams for Arabic movies 289510/599672 and Arabic TV 84299/224882.${extra}`;
  }
  const ids = [...new Set(provider.tests.map((test) => `${test.mediaType} ${test.id}`))];
  const counts = provider.tests.map((test) => test.count || 0);
  const invalid = counts.some(Boolean) ? ' Returned objects lacked a supported stream URL.' : '';
  return `0 valid streams for ${ids.join(', ')}.${invalid}`;
}

const repos = ['nuviotr', 'nuvio-providers', 'NuvioRepo', 'All-in-One-Nuvio'];
const summary = {};
for (const repo of repos) {
  const providers = data.providers.filter((provider) => provider.repo === repo);
  summary[repo] = { total: providers.length, working: 0, no_match: 0, broken: 0, incompatible: 0 };
  for (const provider of providers) summary[repo][classify(provider)]++;
}

const webstreamr = webData.sources.map((source) => {
  const responseErrorCount = webData.cases.reduce(
    (count, testCase) => count + (testCase.errorTitles || []).filter(title => title === `🔗 ${source.name}`).length,
    0,
  );
  const errorCount = Math.max(source.errorCount || 0, responseErrorCount);
  const status = source.resolvedStreams > 0
    ? 'working'
    : source.maxReturned > 0
      ? 'partial'
      : errorCount > 0
        ? 'error'
        : 'no_match';
  let note;
  if (status === 'working') {
    const bestIndex = source.resolvedCounts.reduce(
      (best, count, index, counts) => count > counts[best] ? index : best,
      0,
    );
    const bestCase = webData.cases[bestIndex];
    const bestCount = source.resolvedCounts[bestIndex];
    note = `${bestCase.label} resolved ${bestCount} final stream${bestCount === 1 ? '' : 's'}; ${source.resolvedStreams} across all cases.`;
    if (errorCount) note += ` Also errored on ${errorCount} case${errorCount === 1 ? '' : 's'}.`;
  } else if (status === 'partial') {
    note = `Returned up to ${source.maxReturned} embed locator${source.maxReturned === 1 ? '' : 's'} per case, but extraction produced no final playable URL.`;
  } else if (status === 'error') {
    note = `Runtime/upstream error on ${errorCount} tested case${errorCount === 1 ? '' : 's'}; no final streams.`;
  } else {
    const supportedCases = webData.cases.filter(testCase => source.types.includes(testCase.type)).length;
    note = `Returned 0 source results across ${supportedCases} supported test cases.`;
  }
  return { ...source, status, errorCount, note };
});
const webSummary = webstreamr.reduce((counts, source) => {
  counts[source.status] = (counts[source.status] || 0) + 1;
  return counts;
}, {});

const languageNames = {
  ar: 'Arabic', ba: 'Bengali', bn: 'Bengali', ch: 'Chinese', de: 'German',
  en: 'English', es: 'Spanish', fr: 'French', gu: 'Gujarati', hi: 'Hindi',
  id: 'Indonesian', it: 'Italian', ita: 'Italian', ja: 'Japanese', ko: 'Korean',
  ml: 'Malayalam', multi: 'Multilingual', pa: 'Punjabi', pt: 'Portuguese',
  ru: 'Russian', ta: 'Tamil', te: 'Telugu', th: 'Thai', tr: 'Turkish',
  vi: 'Vietnamese', zh: 'Chinese',
};

function normalizedId(id) {
  const normalized = id.toLowerCase();
  return normalized === 'orphan-yabanci-vidlink' ? 'vidlink' : normalized;
}

function clean(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e]/g, '').trim();
}

function combinedCatalog() {
  const catalog = new Map();
  const get = (id) => {
    if (!catalog.has(id)) catalog.set(id, { id, nuvio: [], web: [] });
    return catalog.get(id);
  };
  for (const provider of data.providers) get(normalizedId(provider.id)).nuvio.push(provider);
  for (const source of webstreamr) get(normalizedId(source.id)).web.push(source);

  const groupFor = new Map();
  for (const [group, ids] of Object.entries(groups)) {
    for (const id of ids) {
      if (groupFor.has(id)) throw new Error(`Duplicate combined-catalog group assignment: ${id}`);
      groupFor.set(id, group);
    }
  }
  const missing = [...catalog.keys()].filter(id => !groupFor.has(id));
  const stale = [...groupFor.keys()].filter(id => !catalog.has(id));
  if (missing.length || stale.length) {
    throw new Error(`Combined catalog mismatch. Missing: ${missing.join(', ') || 'none'}; stale: ${stale.join(', ') || 'none'}`);
  }

  for (const item of catalog.values()) {
    item.group = groupFor.get(item.id);
    const manifestLanguages = new Set(item.nuvio.flatMap(provider => provider.contentLanguage || []));
    item.languages = languageOverrides[item.id]
      || [...manifestLanguages].map(code => languageNames[String(code).toLowerCase()] || code).sort().join(', ')
      || ({
        'Turkish-localized': 'Turkish; sometimes English/original audio',
        'Arabic-targeted / mixed MENA': 'Arabic, English; title-dependent Hindi/Turkish',
        'Spanish-localized': 'Spanish', 'French-localized': 'French',
        'German-localized': 'German', 'Italian-localized': 'Italian',
        'Albanian-localized': 'Albanian',
      }[item.group] || 'Language varies by title/upstream; not reliably tagged');
    item.origin = origins[item.group];
    item.copies = [...new Set([
      ...item.nuvio.map(provider => provider.repo),
      ...item.web.map(() => 'WebStreamrMBG'),
    ])];

    const successfulProviders = item.nuvio.filter(provider => classify(provider) === 'working');
    const successfulWeb = item.web.filter(source => source.status === 'working');
    const qualities = [...new Set(successfulProviders.flatMap(provider => provider.tests)
      .filter(test => test.status === 'returned_streams')
      .flatMap(test => test.samples || [])
      .map(sample => clean(sample.quality))
      .filter(Boolean))];
    const qualityText = qualities.join(', ');
    if (/2160|4k/i.test(qualityText)) {
      item.grade = 'A';
      item.quality = `observed ${qualityText}`;
    } else if (/1080|720|\bhd\b/i.test(qualityText)) {
      item.grade = 'B';
      item.quality = `observed ${qualityText}`;
    } else if (successfulProviders.length || successfulWeb.length) {
      item.grade = 'C';
      const details = [];
      if (qualityText) details.push(`observed ${qualityText}`);
      if (successfulWeb.length) details.push(`${successfulWeb.reduce((n, source) => n + source.resolvedStreams, 0)} final WebStreamr resolutions; resolution not reported`);
      if (!details.length) details.push('valid locator(s), resolution not reported');
      item.quality = details.join('; ');
    } else {
      item.grade = 'D';
      const partial = item.web.some(source => source.status === 'partial');
      const errors = item.web.some(source => source.status === 'error');
      const broken = item.nuvio.some(provider => ['broken', 'incompatible'].includes(classify(provider)));
      item.quality = partial ? 'embed locator only; no final URL' : errors ? 'repeatable source error; no final URL' : broken ? 'packaging/interface defect or no working copy' : 'no final locator in the tested matrix';
    }
    item.priority = priorityOverrides[item.id]
      || (item.grade === 'A' || item.grade === 'B' ? 'P1' : item.grade === 'C' ? 'P2' : 'P3');

    const workingCopies = [
      ...successfulProviders.map(provider => provider.repo),
      ...successfulWeb.map(() => 'WebStreamrMBG'),
    ];
    const copyIssues = [];
    if (item.nuvio.some(provider => ['broken', 'incompatible'].includes(classify(provider)))) copyIssues.push('another copy has a concrete defect');
    if (item.web.some(source => source.status === 'partial')) copyIssues.push('WebStreamr extraction is partial');
    if (item.web.some(source => source.status === 'error')) copyIssues.push('WebStreamr copy errored');
    item.result = workingCopies.length
      ? `Working in ${[...new Set(workingCopies)].join(', ')}${copyIssues.length ? `; ${copyIssues.join('; ')}` : ''}`
      : 'No working copy in this test';
  }
  return catalog;
}

const catalog = combinedCatalog();

let md = `# Provider audit — 2026-07-19\n\n`;
md += `## Outcome\n\n`;
md += `I exercised every manifest provider in \`nuviotr\`, \`nuvio-providers\`, \`NuvioRepo\`, and \`All-in-One-Nuvio\`, plus the two unregistered provider scripts under \`nuviotr/providers\`. The Nuvio collections contain 119 manifest entries and two unregistered scripts (121 total). Across the two main rounds, 371 provider/title calls were made; targeted compatibility and corrected-Arabic-ID reruns brought the total to 382.\n\n`;
md += `At resolver level, **42 of 121 Nuvio entries returned at least one valid HTTP(S) or magnet locator**. Four entries have concrete packaging/interface defects. The remaining 75 loaded but returned no valid locator for the relevant two-to-four-title matrix and are therefore **inconclusive/no tested match**, not proven dead.\n\n`;
md += `WebStreamrMBG built successfully and the supplied TMDB v4 Read Access Token authenticated correctly with **no TMDB 401 responses**. Of its 21 sources, **${webSummary.working || 0} resolved final streams**, ${webSummary.partial || 0} reached embed-locator stage without a final URL, ${webSummary.no_match || 0} returned no tested match, and ${webSummary.error || 0} produced repeatable runtime/upstream errors.\n\n`;

md += `## Test matrix and method\n\n`;
md += `- General: Fight Club (movie 550), Oppenheimer (movie 872585), Breaking Bad (TV 1396 S1E1), Game of Thrones (TV 1399 S1E1).\n`;
md += `- Turkish: Miracle in Cell No. 7 (movie 637920), Recep Ivedik 5 (movie 438703), The Protector (TV 79026 S1E1), Ezel (TV 32519 S1E1).\n`;
md += `- Arabic: The Blue Elephant (movie 289510), The Blue Elephant 2 (movie 599672), Al Hayba (TV 84299 S1E1), The Assassins (TV 224882 S1E1).\n`;
md += `- Anime/Korean: Spirited Away (129), Your Name (372058), One Piece (37854), Naruto (46260), Parasite (496243), Squid Game (93405), The 8th Night (845783), Queen of Tears (215720).\n`;
md += `- Indian/Tamil: Leo (949229), RRR (579974), Suzhal (200861), Sacred Games (79352). Cartoons: Inside Out (150540), Soul (508442), Rick and Morty (60625), Gravity Falls (40075).\n\n`;
md += `Each supported media type received a relevant first-round ID. Providers with no first-round success received an alternate ID. Calls used a 15-second per-fetch cap and a 40-second total provider-call cap. Third-party Nuvio scripts ran in a restricted VM with no real environment, no workspace/filesystem access, no supplied TMDB credential, and an import allowlist. The v4 token was supplied only to the trusted WebStreamrMBG process environment and was not written to this report or any repository file.\n\n`;
md += `“Working” means the provider resolved at least one syntactically valid stream locator. It does **not** mean the entire video was played to completion. “No tested match” can mean a dead upstream, geo/rate blocking, catalog miss, required provider settings, or a parser regression; retest in Nuvio’s Hermes Plugin Tester before removal.\n\n`;

md += `## Nuvio collection summary\n\n`;
md += `| Collection | Entries tested | Working | No tested match | Concrete broken/incompatible |\n|---|---:|---:|---:|---:|\n`;
for (const repo of repos) {
  const s = summary[repo];
  md += `| ${repo} | ${s.total} | ${s.working} | ${s.no_match} | ${s.broken + s.incompatible} |\n`;
}
md += `| **Total** | **121** | **42** | **75** | **4** |\n\n`;

md += `## Combined provider catalog and implementation priority\n\n`;
md += `This is the cross-folder view: matching provider IDs are one row, while the **Copies** column preserves where each implementation lives. It contains **${catalog.size} normalized provider identities** across the four Nuvio collections and WebStreamrMBG. Stream language/localization and content origin are intentionally separate. Language values come from manifests, source country tags, provider code, and targeted web checks; they describe catalog tendency, not a guarantee for every returned file. Homepage notes distinguish web-verified sites from code-declared, rotating, API-only, or unavailable public pages.\n\n`;
md += `Quality is resolver-level evidence from this audit: **A** = observed 2160p/4K; **B** = observed HD/720p/1080p; **C** = a final locator resolved but its resolution was unknown/Auto, indirect, or magnet-based; **D** = no final locator, partial extraction, error, or a concrete defect. This does not verify bitrate, codec correctness, audio tracks, subtitle sync, uptime, geo-access, or full playback.\n\n`;
md += `Priority means: **P0** implement first (observed 4K/HD or unusually strong multi-result coverage, plus broad value); **P1** high-value regional or strong HD source; **P2** fallback/optional because quality is unknown, indirect, fragile, or substantially overlaps stronger sources; **P3** investigate/retest before implementation; **P4** do not implement until a known defect, error, or required private configuration is fixed. A unique regional source can rank P1 even with grade C because language coverage is part of implementation value.\n\n`;
const priorityCounts = [...catalog.values()].reduce((counts, item) => {
  counts[item.priority] = (counts[item.priority] || 0) + 1;
  return counts;
}, {});
md += `| P0 | P1 | P2 | P3 | P4 |\n|---:|---:|---:|---:|---:|\n`;
md += `| ${priorityCounts.P0 || 0} | ${priorityCounts.P1 || 0} | ${priorityCounts.P2 || 0} | ${priorityCounts.P3 || 0} | ${priorityCounts.P4 || 0} |\n\n`;
const p0Names = [...catalog.values()].filter(item => item.priority === 'P0')
  .map(item => `\`${item.nuvio[0]?.name || item.web[0]?.name || item.id}\``);
md += `Recommended first implementation wave: ${p0Names.join(', ')}. Implement the P1 regional sources next by the languages your product intends to support, rather than treating P1 as a single global ordering.\n\n`;

for (const [group, ids] of Object.entries(groups)) {
  md += `### ${group}\n\n`;
  md += `| Provider | Copies | Homepage | Stream language/localization | Content origin/market | Live result and source quality | Grade | Priority |\n|---|---|---|---|---|---|:---:|:---:|\n`;
  for (const id of ids) {
    const item = catalog.get(id);
    const homepage = homepages[id] || [null, 'homepage not identified'];
    const home = homepage[0] ? `[${new URL(homepage[0]).hostname}](${homepage[0]}) — ${homepage[1]}` : `— ${homepage[1]}`;
    const providerName = item.nuvio[0]?.name || item.web[0]?.name || id;
    const cells = [providerName, item.copies.join(', '), home, item.languages, item.origin, `${item.result}. ${item.quality}`, item.grade, item.priority];
    md += `| ${cells.map(value => String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |\n`;
  }
  md += `\n`;
}

for (const repo of repos) {
  md += `## ${repo}\n\n`;
  md += `| Provider | Manifest state | Result | Evidence |\n|---|---|---|---|\n`;
  for (const provider of data.providers.filter((item) => item.repo === repo)) {
    const status = classify(provider);
    const state = provider.registered === false ? 'Unregistered' : provider.enabled === false ? 'Disabled' : 'Enabled';
    md += `| ${provider.id} | ${state} | ${statusIcon[status]} | ${evidence(provider, status).replace(/\|/g, '\\|')} |\n`;
  }
  md += `\n`;
}

md += `## WebStreamrMBG\n\n`;
md += `Build: \`npm run build\` passed on Node ${process.versions.node}. The v4-token live run used movies Fight Club (550), Oppenheimer (872585), and Leo (949229), plus Breaking Bad (1396), Game of Thrones (1399), and Squid Game (93405), all at S1E1. Every source language and error reporting were enabled.\n\n`;
md += `| Working | Partial | No tested match | Error |\n|---:|---:|---:|---:|\n| ${webSummary.working || 0} | ${webSummary.partial || 0} | ${webSummary.no_match || 0} | ${webSummary.error || 0} |\n\n`;
md += `| Source | Types | Result | Evidence |\n|---|---|---|---|\n`;
for (const source of webstreamr) {
  const rendered = source.status === 'working' ? '✅ Working' : source.status === 'partial' ? '🟡 Partial' : source.status === 'error' ? '❌ Error' : '⚠️ No tested match';
  md += `| ${source.name} | ${source.types.join(', ')} | ${rendered} | ${source.note} |\n`;
}
md += `\nThe v4 token removed the earlier authentication blocker. “Error” here identifies a source-level failure during the live run; it does not necessarily distinguish a provider parser defect from a dead or blocking upstream site.\n\n`;

md += `## Concrete defects to fix first\n\n`;
md += `1. \`nuviotr/m3u.mooncrown.addon\`: manifest points to missing \`eklentiler/M3U/ListM3u.js\`. A similarly named file exists at \`providers/M3U/ListM3u.js\`, but it does not implement the array-returning Nuvio \`getStreams\` contract in local tests.\n`;
md += `2. \`nuvio-providers/moviebox\`: manifest points to missing \`providers/moviebox.js\`.\n`;
md += `3. \`nuvio-providers/myflixer-extractor\`: registered as a provider, but the file exports extractor helpers rather than \`getStreams\`.\n`;
md += `4. \`nuviotr/providers/M3U/ListM3u.js\`: unregistered and interface-incompatible for direct provider testing.\n\n`;
md += `Other configuration-specific issue: All-in-One GramCinema loaded but refused to run without its own provider token in Nuvio settings.\n\n`;

md += `## Reproduction\n\n`;
md += `The Nuvio audit harness is \`scripts/audit-nuvio-providers.cjs\`; its runner is \`scripts/run-provider-audit.cjs\`. The WebStreamr harness is \`scripts/audit-webstreamr.cjs\`. The report intentionally contains no API key, access token, or full stream URLs. Results reflect network/provider state on 2026-07-19 and can change without code changes.\n`;

const output = process.argv[4];
if (output) {
  fs.writeFileSync(output, md);
  process.stdout.write(`Wrote ${output}\n`);
} else {
  process.stdout.write(md);
}
