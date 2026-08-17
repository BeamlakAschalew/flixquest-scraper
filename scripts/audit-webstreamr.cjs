#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const WEBSTREAMR = path.join(ROOT, 'WebStreamrMBG');
const OUTPUT = process.argv[2] || '/tmp/webstreamr-audit-results.json';
const PORT = String(process.env.WEBSTREAMR_AUDIT_PORT || 51601);
const TOKEN = process.env.TMDB_ACCESS_TOKEN;

if (!TOKEN) {
  throw new Error('TMDB_ACCESS_TOKEN is required');
}

const sourceDefinitions = [
  ['4khdhub', '4KHDHub', ['movie', 'series']],
  ['hdhub4u', 'HDHub4u', ['movie', 'series']],
  ['vixsrc', 'VixSrc', ['movie', 'series']],
  ['vidsrc', 'VidSrc', ['movie', 'series']],
  ['vidzee', 'VidZee', ['movie', 'series']],
  ['moviebox', 'MovieBox', ['movie', 'series']],
  ['kokoshka', 'Kokoshka', ['movie', 'series']],
  ['cinehdplus', 'CineHDPlus', ['series']],
  ['cuevana', 'Cuevana', ['movie', 'series']],
  ['homecine', 'HomeCine', ['movie', 'series']],
  ['verhdlink', 'VerHdLink', ['movie']],
  ['einschalten', 'Einschalten', ['movie']],
  ['kinoger', 'KinoGer', ['movie', 'series']],
  ['megakino', 'MegaKino', ['movie']],
  ['meinecloud', 'MeineCloud', ['movie']],
  ['filmpalast', 'Filmpalast', ['movie', 'series']],
  ['frembed', 'Frembed', ['movie', 'series']],
  ['frenchcloud', 'FrenchCloud', ['movie']],
  ['movix', 'Movix', ['movie', 'series']],
  ['eurostreaming', 'Eurostreaming', ['series']],
  ['mostraguarda', 'MostraGuarda', ['movie']],
];

const cases = [
  { type: 'movie', id: '550', label: 'Fight Club' },
  { type: 'movie', id: '872585', label: 'Oppenheimer' },
  { type: 'movie', id: '949229', label: 'Leo' },
  { type: 'series', id: '1396:1:1', label: 'Breaking Bad S1E1' },
  { type: 'series', id: '1399:1:1', label: 'Game of Thrones S1E1' },
  { type: 'series', id: '93405:1:1', label: 'Squid Game S1E1' },
];

const config = {
  multi: 'on', al: 'on', es: 'on', mx: 'on', de: 'on', fr: 'on', it: 'on',
  hi: 'on', ta: 'on', te: 'on', gu: 'on', ml: 'on', pa: 'on',
  showErrors: 'on', includeExternalUrls: 'on',
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/ready`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await delay(250);
  }
  throw new Error('WebStreamrMBG did not become ready');
}

function sourceIdFromStream(stream) {
  const bingeGroup = stream?.behaviorHints?.bingeGroup;
  if (typeof bingeGroup !== 'string') return undefined;
  const prefix = 'webstreamr-mbg-';
  if (!bingeGroup.startsWith(prefix)) return undefined;
  const remainder = bingeGroup.slice(prefix.length);
  return sourceDefinitions.map(([id]) => id)
    .sort((a, b) => b.length - a.length)
    .find(id => remainder === id || remainder.startsWith(`${id}-`));
}

async function main() {
  let logs = '';
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: WEBSTREAMR,
    env: {
      ...process.env,
      PORT,
      TMDB_ACCESS_TOKEN: TOKEN,
      NODE_ENV: 'development',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { logs += chunk.toString(); });
  child.stderr.on('data', chunk => { logs += chunk.toString(); });

  const results = [];
  try {
    await waitUntilReady();
    for (const testCase of cases) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 180000);
      try {
        const url = `http://127.0.0.1:${PORT}/${encodeURIComponent(JSON.stringify(config))}/stream/${testCase.type}/tmdb:${testCase.id}.json`;
        const response = await fetch(url, { signal: controller.signal });
        const body = await response.json();
        const streams = Array.isArray(body.streams) ? body.streams : [];
        const resolvedBySource = {};
        for (const stream of streams) {
          const sourceId = sourceIdFromStream(stream);
          if (!sourceId) continue;
          resolvedBySource[sourceId] = (resolvedBySource[sourceId] || 0) + 1;
        }
        results.push({
          ...testCase,
          httpStatus: response.status,
          streamCount: streams.length,
          resolvedBySource,
          errorTitles: streams
            .filter(stream => typeof stream.title === 'string' && stream.title.includes('❌'))
            .map(stream => stream.title.split('\n')[0]),
        });
      } catch (error) {
        results.push({ ...testCase, error: error.message });
      } finally {
        clearTimeout(timer);
      }
    }
  } finally {
    child.kill('SIGINT');
    await Promise.race([
      new Promise(resolve => child.once('close', resolve)),
      delay(5000).then(() => child.kill('SIGKILL')),
    ]);
  }

  const sources = sourceDefinitions.map(([id, name, types]) => {
    const returnedCounts = [...logs.matchAll(new RegExp(`Source ${id} returned (\\d+) results`, 'g'))]
      .map(match => Number(match[1]));
    const resolvedCounts = results.map(result => result.resolvedBySource?.[id] || 0);
    const logErrorCount = [...logs.matchAll(new RegExp(`(?:^|\\s)${id} error:`, 'gmi'))].length;
    const responseErrorCount = results.reduce(
      (count, result) => count + (result.errorTitles || []).filter(title => title === `🔗 ${name}`).length,
      0,
    );
    const errorCount = Math.max(logErrorCount, responseErrorCount);
    const maxReturned = returnedCounts.length ? Math.max(...returnedCounts) : 0;
    const resolvedStreams = resolvedCounts.reduce((sum, count) => sum + count, 0);
    const status = resolvedStreams > 0
      ? 'working'
      : maxReturned > 0
        ? 'partial'
        : errorCount > 0
          ? 'error'
          : 'no_match';
    return {
      id, name, types, status, maxReturned, resolvedStreams, errorCount,
      returnedCounts, resolvedCounts,
    };
  });

  const tmdbUnauthorized = /Got 401 \(Unauthorized\) for https:\/\/api\.themoviedb\.org/.test(logs);
  const payload = {
    generatedAt: new Date().toISOString(),
    tokenPresent: true,
    tokenPrinted: false,
    tmdbUnauthorized,
    cases: results,
    sources,
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    output: OUTPUT,
    tmdbUnauthorized,
    sources: Object.fromEntries(sources.map(source => [source.id, source.status])),
  }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
