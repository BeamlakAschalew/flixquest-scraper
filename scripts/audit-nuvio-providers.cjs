#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const FETCH_TIMEOUT_MS = Number(process.env.AUDIT_FETCH_TIMEOUT_MS || 30000);
const CALL_TIMEOUT_MS = Number(process.env.AUDIT_CALL_TIMEOUT_MS || 90000);

function quietConsole(messages) {
  const capture = (level) => (...args) => {
    if (messages.length >= 20) return;
    const text = args.map((value) => {
      if (value instanceof Error) return value.message;
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    }).join(' ').replace(/https?:\/\/\S+/g, '[url]');
    messages.push(`${level}: ${text.slice(0, 500)}`);
  };
  return {
    log: capture('log'), info: capture('info'), warn: capture('warn'),
    error: capture('error'), debug: capture('debug'),
  };
}

function timedFetch(input, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('audit fetch timeout')), FETCH_TIMEOUT_MS);
  const upstreamSignal = init.signal;
  if (upstreamSignal) {
    if (upstreamSignal.aborted) controller.abort(upstreamSignal.reason);
    else upstreamSignal.addEventListener('abort', () => controller.abort(upstreamSignal.reason), { once: true });
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function loadProvider(filename, messages) {
  const absolute = path.resolve(ROOT, filename);
  const code = fs.readFileSync(absolute, 'utf8');
  const allowedPackages = new Set(['axios', 'cheerio', 'cheerio-without-node-native', 'crypto-js', 'url']);
  const restrictedRequire = (specifier) => {
    if (!allowedPackages.has(specifier)) {
      throw new Error(`blocked provider import: ${specifier}`);
    }
    // The React-Native compatibility fork is not installed in this aggregate
    // workspace. Its provider-facing load()/selector API is compatible with
    // cheerio for these local Node checks, so use the installed parser here.
    if (specifier === 'cheerio-without-node-native') return require('cheerio');
    return require(specifier);
  };
  const mod = { exports: {} };
  const fakeProcess = Object.freeze({
    env: Object.freeze({}),
    platform: 'linux',
    versions: Object.freeze({ node: process.versions.node }),
  });
  const sandbox = {
    module: mod,
    exports: mod.exports,
    require: restrictedRequire,
    __filename: '/provider/provider.js',
    __dirname: '/provider',
    process: fakeProcess,
    console: quietConsole(messages),
    fetch: timedFetch,
    Headers, Request, Response, URL, URLSearchParams,
    AbortController, AbortSignal, TextDecoder, TextEncoder, Blob, FormData,
    Buffer, structuredClone,
    atob: (value) => Buffer.from(String(value), 'base64').toString('binary'),
    btoa: (value) => Buffer.from(String(value), 'binary').toString('base64'),
    setTimeout, clearTimeout, setInterval, clearInterval,
    globalThis: null,
    global: null,
    providerSettings: {},
  };
  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;
  const context = vm.createContext(sandbox);
  const expose = `\n;globalThis.__auditExports = (typeof getStreams === 'function') ? { getStreams } : module.exports;`;
  new vm.Script(code + expose, { filename: absolute }).runInContext(context, { timeout: 15000 });
  const exported = context.__auditExports || mod.exports;
  if (!exported || typeof exported.getStreams !== 'function') {
    throw new Error('getStreams export was not found');
  }
  return exported.getStreams;
}

function summarizeStream(stream) {
  if (!stream || typeof stream !== 'object') return { valid: false, reason: 'non-object result' };
  const rawUrl = stream.url || stream.externalUrl || stream.file || stream.streamUrl || stream.link || stream.magnet;
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return { valid: false, reason: 'missing URL' };
  const url = rawUrl.trim();
  const validScheme = /^(https?|magnet):/i.test(url);
  return {
    valid: validScheme,
    reason: validScheme ? undefined : 'unsupported URL scheme',
    scheme: url.match(/^([^:]+):/)?.[1]?.toLowerCase() || 'none',
    host: /^https?:/i.test(url) ? (() => { try { return new URL(url).host; } catch { return 'invalid'; } })() : undefined,
    type: stream.type || stream.format,
    quality: stream.quality,
    provider: stream.provider || stream.name,
  };
}

async function main() {
  const [, , filename, tmdbId, mediaType, season = '1', episode = '1'] = process.argv;
  if (!filename || !tmdbId || !mediaType) {
    throw new Error('usage: audit-nuvio-providers.cjs <file> <tmdbId> <movie|tv> [season] [episode]');
  }
  const messages = [];
  const started = Date.now();
  try {
    const getStreams = loadProvider(filename, messages);
    const result = await Promise.race([
      Promise.resolve(getStreams(String(tmdbId), mediaType, Number(season), Number(episode), { tmdbId: String(tmdbId) })),
      new Promise((_, reject) => setTimeout(() => reject(new Error('provider call timeout')), CALL_TIMEOUT_MS)),
    ]);
    const streams = Array.isArray(result) ? result : [];
    const summaries = streams.slice(0, 5).map(summarizeStream);
    process.stdout.write(JSON.stringify({
      status: Array.isArray(result) ? (streams.some((_, i) => summaries[i]?.valid) ? 'returned_streams' : 'empty_or_invalid') : 'invalid_return',
      count: streams.length,
      validCount: summaries.filter((item) => item.valid).length,
      samples: summaries,
      durationMs: Date.now() - started,
      messages,
    }));
  } catch (error) {
    process.stdout.write(JSON.stringify({
      status: /timeout/i.test(error.message) ? 'timeout' : 'error',
      error: error.message,
      durationMs: Date.now() - started,
      messages,
    }));
  }
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({ status: 'harness_error', error: error.message }));
  process.exitCode = 1;
});
