import crypto from 'node:crypto'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ORIGIN = (process.env.VIDFAST_ORIGIN || 'https://vidfast.vc').replace(/\/$/, '')
const PROBE_PATH = process.env.VIDFAST_UPDATE_PROBE_PATH || '/movie/550'
const REQUEST_TIMEOUT_MS = positiveInt(process.env.VIDFAST_UPDATE_TIMEOUT_MS, 45_000)
const INTERVAL_MS = positiveInt(process.env.VIDFAST_UPDATE_INTERVAL_MS, 60 * 60 * 1000)
const MAX_ASSET_BYTES = positiveInt(process.env.VIDFAST_UPDATE_MAX_ASSET_BYTES, 8 * 1024 * 1024)

const REQUIRED_CHUNKS = new Map([
  ['255', 'chunk-213.js'],
  ['268', 'chunk-aaea2bcf.js'],
  ['771', 'chunk-771.js'],
  ['365', 'chunk-365.js'],
])

function positiveInt(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function log(message) {
  console.log(`[VidFastUpdater] ${message}`)
}

function timeoutSignal(ms) {
  return AbortSignal.timeout(ms)
}

export function extractScriptUrls(html, origin = ORIGIN) {
  const urls = new Set()
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    const source = match[1].replaceAll('&amp;', '&')
    const url = new URL(source, origin)
    if (url.origin !== origin || !url.pathname.startsWith('/_next/static/')) continue
    if (!url.pathname.endsWith('.js')) continue
    urls.add(url.href)
  }
  return [...urls]
}

export function webpackChunkIds(source) {
  const match = source.match(/\.push\(\[\[([^\]]+)\]/)
  if (!match) return []
  return match[1]
    .split(',')
    .map(value => value.trim())
    .filter(value => /^\d+$/.test(value))
}

async function fetchBytes(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/javascript,*/*;q=0.8',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122 Safari/537.36',
    },
    signal: timeoutSignal(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > MAX_ASSET_BYTES) {
    throw new Error(`${url} exceeds ${MAX_ASSET_BYTES} byte safety limit`)
  }
  return bytes
}

async function discoverBundle() {
  const page = await fetchBytes(`${ORIGIN}${PROBE_PATH}`)
  const scripts = extractScriptUrls(page.toString('utf8'))
  if (!scripts.length) throw new Error('VidFast page contained no Next.js scripts')

  const downloaded = await Promise.all(
    scripts.map(async url => ({ url, bytes: await fetchBytes(url) })),
  )
  const assets = new Map()
  for (const item of downloaded) {
    for (const id of webpackChunkIds(item.bytes.toString('utf8'))) {
      if (REQUIRED_CHUNKS.has(id) && !assets.has(id)) assets.set(id, item)
    }
  }
  const missing = [...REQUIRED_CHUNKS.keys()].filter(id => !assets.has(id))
  if (missing.length) throw new Error(`required player chunks missing: ${missing.join(', ')}`)

  return [...REQUIRED_CHUNKS].map(([chunkId, filename]) => {
    const item = assets.get(chunkId)
    return {
      chunkId,
      filename,
      sourceUrl: item.url,
      bytes: item.bytes,
      sha256: crypto.createHash('sha256').update(item.bytes).digest('hex'),
    }
  })
}

async function makeStage(assets) {
  const stage = await fs.mkdtemp(path.join(ROOT, '.vidfast-assets-stage-'))
  for (const asset of assets) {
    await fs.writeFile(path.join(stage, asset.filename), asset.bytes, { mode: 0o644 })
  }
  return stage
}

async function validateStage(stage, assets) {
  const routeSource = assets.find(asset => asset.filename === 'chunk-365.js').bytes.toString('utf8')
  const routeMatch = routeSource.match(
    /fetch\(""\.concat\("([^"]+)","\/"\)\.concat\("([^"]+)","\/"\)\.concat\(n\[/,
  )
  if (!routeMatch) throw new Error('candidate player bundle has no recognizable stream route')

  const runtimePath = validationModulePath('vidfast-runtime')
  const runtimeUrl = pathToFileURL(runtimePath).href
  const code = `
    import { isPlayerApiUrl } from ${JSON.stringify(runtimeUrl)};
    const route = ${JSON.stringify(`${ORIGIN}${routeMatch[1]}`)};
    if (!isPlayerApiUrl(route)) throw new Error('player API route validation failed');
  `
  await runNode(code, {
    VIDFAST_ASSET_DIR: stage,
    VIDFAST_ORIGIN: ORIGIN,
    VIDFAST_VALIDATION_MODULE_PATH: runtimePath,
  }, 60_000)

  if (process.env.VIDFAST_UPDATE_SKIP_LIVE_SMOKE === 'true') return
  const providerPath = validationModulePath('vidfast')
  const providerUrl = pathToFileURL(providerPath).href
  const smokeCode = `
    import { vidFastProvider } from ${JSON.stringify(providerUrl)};
    const links = await vidFastProvider.streamMovie('550');
    if (!Array.isArray(links) || links.length === 0) throw new Error('live player smoke test returned no links');
  `
  await runNode(smokeCode, {
    VIDFAST_ASSET_DIR: stage,
    VIDFAST_ORIGIN: ORIGIN,
    FORWARD_PROXY_ALWAYS: 'false',
    VIDFAST_VALIDATION_MODULE_PATH: providerPath,
  }, 120_000)
}

function runNode(code, extraEnv, timeoutMs) {
  return new Promise((resolve, reject) => {
    const loader = extraEnv.VIDFAST_VALIDATION_MODULE_PATH?.endsWith('.ts')
      ? ['--import', 'tsx']
      : []
    const child = spawn(process.execPath, [...loader, '--input-type=module', '--eval', code], {
      cwd: ROOT,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const collect = chunk => {
      output += chunk.toString()
      if (output.length > 20_000) output = output.slice(-20_000)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`validation timed out after ${timeoutMs}ms\n${output}`))
    }, timeoutMs)
    child.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`validation failed (${signal || `exit ${code}`})\n${output}`))
    })
  })
}

function validationModulePath(name) {
  const compiled = path.join(ROOT, 'dist/providers', `${name}.js`)
  if (existsSync(compiled)) return compiled
  return path.join(ROOT, 'src/providers', `${name}.ts`)
}

async function hashExisting(target, filename) {
  try {
    const bytes = await fs.readFile(path.join(target, filename))
    return crypto.createHash('sha256').update(bytes).digest('hex')
  } catch {
    return null
  }
}

async function isCurrent(target, assets) {
  const hashes = await Promise.all(assets.map(asset => hashExisting(target, asset.filename)))
  return hashes.every((hash, index) => hash === assets[index].sha256) &&
    Boolean(await hashExisting(target, 'manifest.json'))
}

async function writeManifest(target, assets) {
  const manifest = {
    schemaVersion: 1,
    origin: ORIGIN,
    probePath: PROBE_PATH,
    checkedAt: new Date().toISOString(),
    assets: Object.fromEntries(
      assets.map(asset => [asset.filename, {
        chunkId: asset.chunkId,
        sourceUrl: asset.sourceUrl,
        sha256: asset.sha256,
        bytes: asset.bytes.byteLength,
      }]),
    ),
  }
  const temporary = `${target}/manifest.json.next`
  await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 })
  await fs.rename(temporary, `${target}/manifest.json`)
}

async function publish(target, assets) {
  await fs.mkdir(target, { recursive: true })
  const targetKey = crypto.createHash('sha256').update(target).digest('hex').slice(0, 12)
  const backupRoot = path.join(ROOT, '.vidfast-backups', targetKey)
  await fs.rm(backupRoot, { recursive: true, force: true })
  await fs.mkdir(backupRoot, { recursive: true })
  for (const filename of [...assets.map(asset => asset.filename), 'manifest.json']) {
    try { await fs.copyFile(path.join(target, filename), path.join(backupRoot, filename)) } catch {}
  }

  try {
    for (const asset of assets) {
      const temporary = path.join(target, `.${asset.filename}.next`)
      await fs.writeFile(temporary, asset.bytes, { mode: 0o644 })
      await fs.rename(temporary, path.join(target, asset.filename))
    }
    await writeManifest(target, assets)
  } catch (error) {
    for (const filename of [...assets.map(asset => asset.filename), 'manifest.json']) {
      try {
        const backup = path.join(backupRoot, filename)
        const temporary = path.join(target, `.${filename}.rollback`)
        await fs.copyFile(backup, temporary)
        await fs.rename(temporary, path.join(target, filename))
      } catch {}
    }
    throw error
  }
}

function targetDirectories() {
  const configured = process.env.VIDFAST_UPDATE_TARGETS
  if (configured) return configured.split(path.delimiter).filter(Boolean).map(value => path.resolve(ROOT, value))
  const source = path.join(ROOT, 'src/providers/vidfast-assets')
  const dist = path.join(ROOT, 'dist/providers/vidfast-assets')
  const targets = []
  if (existsSync(source)) targets.push(source)
  if (existsSync(dist)) targets.push(dist)
  if (process.env.VIDFAST_ASSET_DIR) targets.push(path.resolve(process.env.VIDFAST_ASSET_DIR))
  if (!targets.length) targets.push(source)
  return [...new Set(targets)]
}

export async function updateVidFastPlayer() {
  const assets = await discoverBundle()
  const stage = await makeStage(assets)
  try {
    const targets = targetDirectories()
    const current = await Promise.all(targets.map(target => isCurrent(target, assets)))
    log(current.every(Boolean)
      ? 'Player bundle is unchanged; validating live decryption'
      : 'New player bundle detected; validating staged assets')
    await validateStage(stage, assets)
    if (current.every(Boolean)) {
      log('Player bundle is unchanged and healthy')
      return { changed: false, assets }
    }
    for (const target of targets) {
      await publish(target, assets)
      log(`Published ${assets.length} chunks to ${path.relative(ROOT, target)}`)
    }
    return { changed: true, assets }
  } finally {
    await fs.rm(stage, { recursive: true, force: true })
  }
}

export async function startVidFastPlayerUpdater() {
  let running = false
  const run = async () => {
    if (running) return log('Previous update is still running; skipping interval')
    running = true
    try { await updateVidFastPlayer() } catch (error) {
      console.error(`[VidFastUpdater] ${error instanceof Error ? error.message : error}`)
    } finally { running = false }
  }
  await run()
  return setInterval(run, INTERVAL_MS)
}

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isEntryPoint) {
  const action = process.argv.includes('--once') ? updateVidFastPlayer() : startVidFastPlayerUpdater()
  action.catch(error => {
    console.error(`[VidFastUpdater] Fatal error: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  })
}
