import fs from 'node:fs'
import path from 'node:path'
import tls from 'node:tls'
import { fileURLToPath } from 'node:url'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))

const CONNECT_PROXY_ATTEMPT_TIMEOUT_MS =
  Number(process.env.CONNECT_PROXY_TIMEOUT_MS) || 20_000
const CONNECT_PROXY_MAX_ATTEMPTS =
  Number(process.env.CONNECT_PROXY_MAX_ATTEMPTS) || 3
const ACTIVE_POOL_SIZE = Number(process.env.CONNECT_PROXY_POOL_SIZE) || 20
const POOL_MAX_FAILURES = 3
const POOL_COOLDOWN_MS = 5 * 60_000
const MAX_REDIRECTS = 5

export interface PooledProxy {
  url: string
  host: string
  port: number
  failures: number
  disabledUntil: number
  lastError?: string
}

interface PooledProxyConfig {
  maxFailures: number
  cooldownMs: number
}

function candidateFiles(envVar: string, fallbackName: string): string[] {
  const candidates = new Set<string>()
  if (process.env[envVar]) {
    candidates.add(path.resolve(process.env[envVar] as string))
  }
  candidates.add(path.resolve(process.cwd(), `data/${fallbackName}`))
  candidates.add(path.resolve(MODULE_DIR, `../../data/${fallbackName}`))
  candidates.add(path.resolve(process.cwd(), `dist/data/${fallbackName}`))
  candidates.add(path.resolve(MODULE_DIR, `../../dist/data/${fallbackName}`))
  return [...candidates]
}

function readUrlList(envVar: string, fallbackName: string): string[] {
  const envList = (process.env[envVar] || '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
  if (envList.length > 0) return envList

  for (const file of candidateFiles(envVar, fallbackName)) {
    try {
      const contents = fs.readFileSync(file, 'utf8')
      const urls = contents
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
      if (urls.length > 0) return urls
    } catch {
      // Try the next candidate location.
    }
  }
  return []
}

function parseProxyUrl(urlStr: string): { host: string; port: number } | null {
  try {
    const parsed = new URL(urlStr)
    const host = parsed.hostname
    const port = parsed.port ? Number(parsed.port) : 443
    return host ? { host, port } : null
  } catch {
    return null
  }
}

function makeProxy(urlStr: string): PooledProxy | null {
  const parsed = parseProxyUrl(urlStr)
  if (!parsed) return null
  return {
    url: urlStr,
    host: parsed.host,
    port: parsed.port,
    failures: 0,
    disabledUntil: 0,
  }
}

class ProxyPool {
  private proxies: PooledProxy[]
  private backup: PooledProxy[]
  private cursor = 0
  private maxSize: number

  constructor(urls: string[], backupUrls: string[], maxSize: number) {
    this.maxSize = maxSize
    this.proxies = []
    for (const url of urls) {
      const proxy = makeProxy(url)
      if (proxy) this.proxies.push(proxy)
      if (this.proxies.length >= this.maxSize) break
    }
    this.backup = []
    const activeUrls = new Set(this.proxies.map(proxy => proxy.url))
    for (const url of backupUrls) {
      if (activeUrls.has(url)) continue
      const proxy = makeProxy(url)
      if (proxy) this.backup.push(proxy)
    }
  }

  size(): number {
    return this.proxies.length
  }

  next(): PooledProxy | undefined {
    const now = Date.now()
    const length = this.proxies.length
    for (let offset = 0; offset < length; offset++) {
      const index = (this.cursor + offset) % length
      const proxy = this.proxies[index]
      if (proxy.disabledUntil > now) continue
      this.cursor = (index + 1) % length
      return proxy
    }
    return undefined
  }

  find(url: string): PooledProxy | undefined {
    return this.proxies.find(proxy => proxy.url === url)
  }

  includes(url: string): boolean {
    return this.proxies.some(proxy => proxy.url === url)
  }

  reportFailure(
    proxy: PooledProxy,
    reason: string,
    config: PooledProxyConfig
  ): void {
    proxy.failures += 1
    proxy.lastError = reason
    if (proxy.failures >= config.maxFailures) {
      this.evict(proxy)
    }
  }

  reportSuccess(proxy: PooledProxy): void {
    proxy.failures = 0
    proxy.lastError = undefined
  }

  /**
   * Removes a dead proxy from the active pool and replaces it in-memory with
   * the next backup candidate. No database write: the replacement lives only
   * for the lifetime of this process (Vercel warm instances rehydrate from the
   * bundled files on cold start).
   */
  private evict(proxy: PooledProxy): void {
    const index = this.proxies.indexOf(proxy)
    if (index !== -1) {
      this.proxies.splice(index, 1)
      if (this.cursor >= index && this.cursor > 0) this.cursor -= 1
    }
    const replacement = this.backup.shift()
    if (replacement && this.proxies.length < this.maxSize) {
      this.proxies.push(replacement)
      console.warn(
        `[ConnectProxy] Evicted ${proxy.url} after ${POOL_MAX_FAILURES} failures; promoted ${replacement.url} from backup (active ${this.proxies.length}/${this.maxSize}, backup ${this.backup.length})`
      )
    } else {
      console.warn(
        `[ConnectProxy] Evicted ${proxy.url} after ${POOL_MAX_FAILURES} failures; no backup remaining (active ${this.proxies.length}/${this.maxSize})`
      )
    }
  }
}

let pool: ProxyPool | null = null

const POOL_CONFIG: PooledProxyConfig = {
  maxFailures: POOL_MAX_FAILURES,
  cooldownMs: POOL_COOLDOWN_MS,
}

export function getConnectProxyPool(): ProxyPool | null {
  if (pool) return pool
  const urls = readUrlList('FORWARD_PROXY_POOL', 'forward-proxies.txt')
  const backupUrls = readUrlList(
    'FORWARD_PROXY_BACKUP_POOL',
    'forward-proxies-backup.txt'
  )
  pool =
    urls.length > 0 ? new ProxyPool(urls, backupUrls, ACTIVE_POOL_SIZE) : null
  if (pool) {
    console.log(
      `[ConnectProxy] Loaded ${pool.size()} active forward proxies (+${backupUrls.length} backup candidates)`
    )
  }
  return pool
}

function connectToProxy(
  proxy: PooledProxy,
  targetHost: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: proxy.host,
      port: proxy.port,
      rejectUnauthorized: false,
      timeout: timeoutMs,
    })
    let settled = false
    let responseBuffer = ''

    socket.on('error', () => {})

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      removeAbortListener()
      fn()
    }
    const timer = setTimeout(() => {
      socket.destroy()
      settle(() =>
        reject(new Error(`proxy connect timeout after ${timeoutMs}ms`))
      )
    }, timeoutMs)

    const onAbort = () => {
      socket.destroy()
      settle(() => reject(new Error('proxy connect aborted')))
    }
    const removeAbortListener = signal?.addEventListener
      ? () => {
          signal?.removeEventListener('abort', onAbort)
        }
      : () => {}

    if (signal) {
      if (signal.aborted) {
        settle(() => reject(new Error('proxy connect aborted')))
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    socket.on('secureConnect', () => {
      socket.write(
        `CONNECT ${targetHost}:443 HTTP/1.1\r\n` +
          `Host: ${targetHost}:443\r\n` +
          `Proxy-Connection: Keep-Alive\r\n\r\n`
      )
    })

    socket.on('data', chunk => {
      responseBuffer += chunk.toString('latin1')
      const headerEnd = responseBuffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return
      const statusLine = responseBuffer.slice(0, headerEnd).split('\r\n')[0]
      const status = Number.parseInt(
        (statusLine.match(/^HTTP\/1\.[01] (\d{3})/) || [])[1] || '0',
        10
      )
      if (status === 200) {
        settle(() => resolve(socket))
      } else {
        socket.destroy()
        settle(() =>
          reject(new Error(`proxy CONNECT failed with HTTP ${status}`))
        )
      }
    })

    socket.on('error', err => {
      settle(() => reject(err))
    })
    socket.on('timeout', () => {
      socket.destroy()
      settle(() => reject(new Error('proxy connect timed out')))
    })
  })
}

interface RawHttpResponse {
  status: number
  statusText: string
  headers: Headers
  body: Buffer
}

function decodeChunked(buffer: Buffer): Buffer {
  const chunks: Buffer[] = []
  let offset = 0
  while (offset < buffer.length) {
    const lineEnd = buffer.indexOf('\r\n', offset)
    if (lineEnd === -1) break
    const size = Number.parseInt(
      buffer.subarray(offset, lineEnd).toString('latin1').trim(),
      16
    )
    if (!Number.isFinite(size)) break
    offset = lineEnd + 2
    if (size === 0) break
    if (offset + size > buffer.length) break
    chunks.push(buffer.subarray(offset, offset + size))
    offset += size + 2
  }
  return Buffer.concat(chunks)
}

function parseHttpResponse(buffer: Buffer): RawHttpResponse {
  const headerEnd = buffer.indexOf('\r\n\r\n')
  if (headerEnd === -1) {
    return {
      status: 0,
      statusText: '',
      headers: new Headers(),
      body: Buffer.alloc(0),
    }
  }
  const headerText = buffer.subarray(0, headerEnd).toString('latin1')
  const lines = headerText.split('\r\n')
  const statusMatch = lines[0].match(/^HTTP\/1\.[01] (\d{3})(?: (.*))?$/)
  const status = statusMatch ? Number.parseInt(statusMatch[1], 10) : 0
  const statusText = statusMatch?.[2] || ''
  const headers = new Headers()
  for (const line of lines.slice(1)) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    headers.append(key, value)
  }

  let body = buffer.subarray(headerEnd + 4)
  if (headers.get('transfer-encoding')?.toLowerCase().includes('chunked')) {
    body = decodeChunked(body)
  } else {
    const contentLength = Number(headers.get('content-length') || '0')
    if (Number.isFinite(contentLength) && contentLength >= 0) {
      body = body.subarray(0, contentLength)
    }
  }
  return { status, statusText, headers, body }
}

function tlsExchange(
  proxySocket: tls.TLSSocket,
  target: URL,
  method: string,
  requestHeaders: Headers,
  bodyBytes: Buffer | null,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      socket: proxySocket,
      host: target.hostname,
      servername: target.hostname,
      rejectUnauthorized: false,
      timeout: timeoutMs,
    })
    let settled = false
    let responseBuffer = Buffer.alloc(0)

    socket.on('error', () => {})

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      removeAbortListener()
      fn()
    }
    const timer = setTimeout(() => {
      socket.destroy()
      settle(() =>
        reject(new Error(`target tls exchange timed out after ${timeoutMs}ms`))
      )
    }, timeoutMs)

    const onAbort = () => {
      socket.destroy()
      settle(() => reject(new Error('target tls exchange aborted')))
    }
    const removeAbortListener = signal?.addEventListener
      ? () => {
          signal?.removeEventListener('abort', onAbort)
        }
      : () => {}

    if (signal) {
      if (signal.aborted) {
        settle(() => reject(new Error('target tls exchange aborted')))
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    socket.on('secureConnect', () => {
      const headerLines: string[] = []
      requestHeaders.forEach((value, key) => {
        const lower = key.toLowerCase()
        if (
          lower === 'host' ||
          lower === 'connection' ||
          lower === 'content-length' ||
          lower === 'transfer-encoding'
        ) {
          return
        }
        headerLines.push(`${key}: ${value}`)
      })
      headerLines.push(`Host: ${target.host}`)
      headerLines.push('Connection: close')
      if (bodyBytes && bodyBytes.length > 0) {
        headerLines.push(`Content-Length: ${bodyBytes.length}`)
      }
      const requestLine =
        `${method} ${target.pathname}${target.search} HTTP/1.1\r\n` +
        `${headerLines.join('\r\n')}\r\n\r\n`
      socket.write(requestLine)
      if (bodyBytes && bodyBytes.length > 0) socket.write(bodyBytes)
    })

    socket.on('data', chunk => {
      responseBuffer = Buffer.concat([responseBuffer, chunk])
    })
    socket.on('end', () => {
      settle(() => resolve(responseBuffer))
    })
    socket.on('close', () => {
      settle(() => resolve(responseBuffer))
    })
    socket.on('error', err => {
      settle(() => reject(err))
    })
    socket.on('timeout', () => {
      socket.destroy()
      settle(() => reject(new Error('target tls exchange timed out')))
    })
  })
}

function buildResponse(raw: RawHttpResponse, finalUrl: string): Response {
  const response = new Response(new Uint8Array(raw.body), {
    status: raw.status || 502,
    statusText: raw.statusText,
    headers: raw.headers,
  })
  Object.defineProperty(response, 'url', { value: finalUrl })
  return response
}

export async function fetchThroughConnectProxy(
  targetUrlStr: string,
  proxy: PooledProxy,
  requestTemplate: Request,
  timeoutMs = CONNECT_PROXY_ATTEMPT_TIMEOUT_MS,
  signal?: AbortSignal
): Promise<Response> {
  let currentUrl = targetUrlStr
  let method = requestTemplate.method
  let bodyBytes: Buffer | null =
    method === 'GET' || method === 'HEAD'
      ? null
      : Buffer.from(await requestTemplate.clone().arrayBuffer())

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const target = new URL(currentUrl)
    const proxySocket = await connectToProxy(
      proxy,
      target.hostname,
      timeoutMs,
      signal
    )
    const rawBuffer = await tlsExchange(
      proxySocket,
      target,
      method,
      requestTemplate.headers,
      bodyBytes,
      timeoutMs,
      signal
    )
    const raw = parseHttpResponse(rawBuffer)
    const location = raw.headers.get('location')

    if (
      raw.status >= 300 &&
      raw.status < 400 &&
      location &&
      requestTemplate.redirect !== 'manual'
    ) {
      if (redirect >= MAX_REDIRECTS) break
      currentUrl = new URL(location, currentUrl).href
      if (raw.status === 303 || (raw.status !== 307 && raw.status !== 308)) {
        method = 'GET'
        bodyBytes = null
      }
      continue
    }

    return buildResponse(raw, currentUrl)
  }

  const target = new URL(targetUrlStr)
  const proxySocket = await connectToProxy(
    proxy,
    target.hostname,
    timeoutMs,
    signal
  )
  const rawBuffer = await tlsExchange(
    proxySocket,
    target,
    method,
    requestTemplate.headers,
    bodyBytes,
    timeoutMs,
    signal
  )
  return buildResponse(parseHttpResponse(rawBuffer), targetUrlStr)
}

export function nextPooledProxy(): PooledProxy | undefined {
  const activePool = getConnectProxyPool()
  return activePool?.next()
}

export function reportPooledProxyFailure(
  proxy: PooledProxy,
  reason: string
): void {
  getConnectProxyPool()?.reportFailure(proxy, reason, POOL_CONFIG)
}

export function reportPooledProxySuccess(proxy: PooledProxy): void {
  getConnectProxyPool()?.reportSuccess(proxy)
}

export function poolSize(): number {
  return getConnectProxyPool()?.size() ?? 0
}

export function findPooledProxy(url: string): PooledProxy | undefined {
  return getConnectProxyPool()?.find(url)
}

export function poolIncludesProxy(url: string): boolean {
  return getConnectProxyPool()?.includes(url) ?? false
}

export function maxConnectProxyAttempts(): number {
  return CONNECT_PROXY_MAX_ATTEMPTS
}
