#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.AUDIT_OUTPUT || '/tmp/nuvio-provider-audit-results.json';
const CONCURRENCY = Number(process.env.AUDIT_CONCURRENCY || 5);
const CHILD_TIMEOUT_MS = Number(process.env.AUDIT_CHILD_TIMEOUT_MS || 100000);
const REPOS = ['nuviotr', 'nuvio-providers', 'NuvioRepo', 'All-in-One-Nuvio'];

const matrices = {
  general: {
    movie: [['550', 'Fight Club'], ['872585', 'Oppenheimer']],
    tv: [['1396', 'Breaking Bad S1E1'], ['1399', 'Game of Thrones S1E1']],
  },
  turkish: {
    movie: [['637920', 'Miracle in Cell No. 7'], ['438703', 'Recep Ivedik 5']],
    tv: [['79026', 'The Protector S1E1'], ['32519', 'Ezel S1E1']],
  },
  arabic: {
    movie: [['289510', 'The Blue Elephant'], ['599672', 'The Blue Elephant 2']],
    tv: [['84299', 'Al Hayba S1E1'], ['224882', 'The Assassins S1E1']],
  },
  anime: {
    movie: [['129', 'Spirited Away'], ['372058', 'Your Name']],
    tv: [['37854', 'One Piece S1E1'], ['46260', 'Naruto S1E1']],
  },
  korean: {
    movie: [['496243', 'Parasite'], ['845783', 'The 8th Night']],
    tv: [['93405', 'Squid Game S1E1'], ['215720', 'Queen of Tears S1E1']],
  },
  indian: {
    movie: [['949229', 'Leo'], ['579974', 'RRR']],
    tv: [['200861', 'Suzhal - The Vortex S1E1'], ['79352', 'Sacred Games S1E1']],
  },
  cartoon: {
    movie: [['150540', 'Inside Out'], ['508442', 'Soul']],
    tv: [['60625', 'Rick and Morty S1E1'], ['40075', 'Gravity Falls S1E1']],
  },
};

function categoryFor(repo, scraper) {
  const text = [scraper.id, scraper.name, scraper.description, ...(scraper.contentLanguage || [])].join(' ').toLowerCase();
  if (repo === 'nuviotr' || /\btr\b|turk|dizi|filmizle|sinewix|sinemac|webteizle|filmmodu/.test(text)) return 'turkish';
  if (/\bar\b|arab|gramcinema/.test(text)) return 'arabic';
  if (/anime|anidb|hianime|anikoto|kurage|allwish/.test(text)) return 'anime';
  if (/kdrama|kisskh|\bko\b|korean/.test(text)) return 'korean';
  if (repo === 'NuvioRepo' || /tamil|hindi|bolly|einthusan|moviesda|isaidub|mallu|hind|vega|\bhi\b|\bta\b|\bte\b/.test(text)) return 'indian';
  if (/cartoon|toonhub/.test(text)) return 'cartoon';
  return 'general';
}

function collectProviders() {
  const providers = [];
  for (const repo of REPOS) {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, repo, 'manifest.json'), 'utf8'));
    for (const scraper of manifest.scrapers) {
      providers.push({ repo, ...scraper, category: categoryFor(repo, scraper), registered: true });
    }
  }
  // nuviotr contains two provider scripts which are not registered in its manifest.
  providers.push({
    repo: 'nuviotr', id: 'orphan-m3u-list', name: 'M3U List (unregistered)',
    filename: 'providers/M3U/ListM3u.js', supportedTypes: ['movie', 'tv'], enabled: false,
    category: 'turkish', registered: false,
  });
  providers.push({
    repo: 'nuviotr', id: 'orphan-yabanci-vidlink', name: 'Yabanci Vidlink (unregistered)',
    filename: 'providers/YABANCI/EKLENTILER/vidlink.js', supportedTypes: ['movie', 'tv'], enabled: false,
    category: 'turkish', registered: false,
  });
  return providers;
}

function casesFor(provider) {
  const supported = provider.supportedTypes || provider.types || [];
  const types = supported.map((type) => type === 'series' ? 'tv' : type).filter((type) => type === 'movie' || type === 'tv');
  const matrix = matrices[provider.category] || matrices.general;
  const cases = [];
  if (types.includes('movie') && types.includes('tv')) {
    cases.push({ mediaType: 'movie', id: matrix.movie[0][0], label: matrix.movie[0][1], round: 1 });
    cases.push({ mediaType: 'tv', id: matrix.tv[0][0], label: matrix.tv[0][1], round: 1 });
    cases.push({ mediaType: 'movie', id: matrix.movie[1][0], label: matrix.movie[1][1], round: 2 });
    cases.push({ mediaType: 'tv', id: matrix.tv[1][0], label: matrix.tv[1][1], round: 2 });
  } else {
    for (const type of types) {
      cases.push({ mediaType: type, id: matrix[type][0][0], label: matrix[type][0][1], round: 1 });
      cases.push({ mediaType: type, id: matrix[type][1][0], label: matrix[type][1][1], round: 2 });
    }
  }
  return cases;
}

function runChild(provider, testCase) {
  return new Promise((resolve) => {
    const relativeFile = path.join(provider.repo, provider.filename);
    const args = [path.join(ROOT, 'scripts/audit-nuvio-providers.cjs'), relativeFile, testCase.id, testCase.mediaType, '1', '1'];
    const child = spawn(process.execPath, args, { cwd: ROOT, env: {
      PATH: process.env.PATH || '',
      AUDIT_FETCH_TIMEOUT_MS: process.env.AUDIT_FETCH_TIMEOUT_MS || '30000',
      AUDIT_CALL_TIMEOUT_MS: process.env.AUDIT_CALL_TIMEOUT_MS || '90000',
    }});
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => stdout += chunk);
    child.stderr.on('data', (chunk) => stderr += chunk);
    const timer = setTimeout(() => child.kill('SIGKILL'), CHILD_TIMEOUT_MS);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      let result;
      try { result = JSON.parse(stdout); }
      catch { result = { status: signal ? 'timeout' : 'harness_error', error: (stderr || stdout || `exit ${code}`).slice(0, 500) }; }
      resolve({ ...testCase, ...result });
    });
  });
}

async function runPool(tasks) {
  let cursor = 0;
  let complete = 0;
  const results = new Array(tasks.length);
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= tasks.length) return;
      const { provider, testCase } = tasks[index];
      const result = await runChild(provider, testCase);
      results[index] = { providerKey: `${provider.repo}/${provider.id}`, result };
      complete++;
      console.log(`[${complete}/${tasks.length}] ${provider.repo}/${provider.id} ${testCase.mediaType}:${testCase.id} -> ${result.status} (${result.count || 0})`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker));
  return results;
}

async function main() {
  const providers = collectProviders();
  for (const provider of providers) provider.tests = [];

  const existing = providers.filter((provider) => fs.existsSync(path.join(ROOT, provider.repo, provider.filename)));
  const missing = providers.filter((provider) => !fs.existsSync(path.join(ROOT, provider.repo, provider.filename)));
  for (const provider of missing) provider.loadIssue = 'manifest file is missing';

  const round1Tasks = existing.flatMap((provider) => casesFor(provider).filter((testCase) => testCase.round === 1).map((testCase) => ({ provider, testCase })));
  console.log(`Round 1: ${round1Tasks.length} tests across ${existing.length} loadable providers`);
  for (const item of await runPool(round1Tasks)) {
    providers.find((provider) => `${provider.repo}/${provider.id}` === item.providerKey).tests.push(item.result);
  }

  const retryProviders = existing.filter((provider) => !provider.tests.some((test) => test.status === 'returned_streams'));
  const round2Tasks = retryProviders.flatMap((provider) => casesFor(provider).filter((testCase) => testCase.round === 2).map((testCase) => ({ provider, testCase })));
  console.log(`Round 2: ${round2Tasks.length} alternate-title tests across ${retryProviders.length} providers without a round-1 success`);
  for (const item of await runPool(round2Tasks)) {
    providers.find((provider) => `${provider.repo}/${provider.id}` === item.providerKey).tests.push(item.result);
  }

  const payload = { generatedAt: new Date().toISOString(), matrices, providers };
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
  const working = providers.filter((provider) => provider.tests.some((test) => test.status === 'returned_streams')).length;
  console.log(`Saved ${OUT}. Working: ${working}; no streams/errors/missing: ${providers.length - working}; total: ${providers.length}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
