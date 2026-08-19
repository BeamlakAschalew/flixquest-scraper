import { Redis, RedisOptions } from 'ioredis'

const DEFAULT_TTL_SECONDS = Number(process.env.REDIS_CACHE_TTL) || 7200 // 2 hours default
const CACHE_PREFIX = 'flixquest:provider:'
const PROVIDER_STATUS_KEY = 'flixquest:provider-status'
const FORWARD_PROXY_PREFERENCE_PREFIX = 'flixquest:fproxy:preferred:'
const FORWARD_PROXY_BLOCKED_PREFIX = 'flixquest:fproxy:blocked:'

const configuredProxyPreferenceTtl = Number(
  process.env.FORWARD_PROXY_PREFERENCE_TTL_SECONDS
)
const configuredProxyFailureTtl = Number(
  process.env.FORWARD_PROXY_FAILURE_TTL_SECONDS
)
export const FORWARD_PROXY_PREFERENCE_TTL_SECONDS =
  Number.isFinite(configuredProxyPreferenceTtl) &&
  configuredProxyPreferenceTtl > 0
    ? configuredProxyPreferenceTtl
    : 24 * 60 * 60
export const FORWARD_PROXY_FAILURE_TTL_SECONDS =
  Number.isFinite(configuredProxyFailureTtl) && configuredProxyFailureTtl > 0
    ? configuredProxyFailureTtl
    : 10 * 60

const isCacheEnabled = process.env.REDIS_CACHE_ENABLED !== 'false'
let redisUrl = process.env.REDIS_URL
const redisHost = process.env.REDIS_HOST
const redisPort = Number(process.env.REDIS_PORT) || 6379
const redisPassword = process.env.REDIS_PASSWORD

// Upstash provides a REST URL + token pair (also injected automatically by the
// Vercel Upstash integration). Derive the equivalent ioredis connection string
// so the same config works locally and on Vercel.
if (!redisUrl && !redisHost && process.env.UPSTASH_REDIS_REST_URL) {
  try {
    const restHost = new URL(process.env.UPSTASH_REDIS_REST_URL).hostname
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || ''
    redisUrl = `rediss://default:${encodeURIComponent(token)}@${restHost}:6379`
  } catch {
    redisUrl = undefined
  }
}

let redisClient: Redis | null = null
let isConnected = false

// Initialize Redis client safely without crashing the app if Redis is unreachable
if (isCacheEnabled && (redisUrl || redisHost)) {
  try {
    const options: RedisOptions = {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false, // Don't queue commands when offline to avoid latency spikes
      connectTimeout: 5000,
      retryStrategy(times) {
        // Exponential backoff up to 30 seconds
        const delay = Math.min(times * 1000, 30000)
        return delay
      },
    }

    if (redisUrl) {
      redisClient = new Redis(redisUrl, options)
    } else if (redisHost) {
      redisClient = new Redis({
        host: redisHost,
        port: redisPort,
        password: redisPassword || undefined,
        ...options,
      })
    }

    if (redisClient) {
      redisClient.on('connect', () => {
        isConnected = true
        console.log('⚡ [Redis] Connected successfully')
      })

      redisClient.on('ready', () => {
        isConnected = true
      })

      redisClient.on('error', err => {
        isConnected = false
        console.warn(`⚠️  [Redis] Connection issue: ${err.message}`)
      })

      redisClient.on('close', () => {
        isConnected = false
      })
    }
  } catch (err) {
    console.warn(
      '⚠️  [Redis] Failed to initialize Redis client:',
      err instanceof Error ? err.message : err
    )
    redisClient = null
    isConnected = false
  }
} else {
  console.log(
    'ℹ️  [Redis] Caching disabled or no connection details configured'
  )
}

export function isRedisAvailable(): boolean {
  return isCacheEnabled && redisClient !== null && isConnected
}

export function getDefaultTtl(): number {
  return DEFAULT_TTL_SECONDS
}

function normalizedProviderKey(providerId: string): string {
  return encodeURIComponent(providerId.toLowerCase().trim())
}

function forwardProxyPreferenceKey(providerId: string): string {
  return `${FORWARD_PROXY_PREFERENCE_PREFIX}${normalizedProviderKey(providerId)}`
}

function forwardProxyBlockedKey(providerId: string): string {
  return `${FORWARD_PROXY_BLOCKED_PREFIX}${normalizedProviderKey(providerId)}`
}

export interface ProviderProxyRouting {
  preferredProxyId?: string
  blockedProxyIds: string[]
}

/**
 * Load the last known good proxy and recently rejected proxies for a provider.
 * Redis failures intentionally degrade to the normal in-memory round robin.
 */
export async function getProviderProxyRouting(
  providerId: string
): Promise<ProviderProxyRouting> {
  if (!providerId || !isRedisAvailable() || !redisClient) {
    return { blockedProxyIds: [] }
  }

  try {
    const results = await redisClient
      .pipeline()
      .get(forwardProxyPreferenceKey(providerId))
      .smembers(forwardProxyBlockedKey(providerId))
      .exec()
    const preferredProxyId = results?.[0]?.[1]
    const blockedProxyIds = results?.[1]?.[1]

    return {
      preferredProxyId:
        typeof preferredProxyId === 'string' ? preferredProxyId : undefined,
      blockedProxyIds: Array.isArray(blockedProxyIds)
        ? blockedProxyIds.filter(
            (proxyId): proxyId is string => typeof proxyId === 'string'
          )
        : [],
    }
  } catch (err) {
    console.warn(
      `⚠️  [Redis] Error loading proxy routing for "${providerId}":`,
      err instanceof Error ? err.message : err
    )
    return { blockedProxyIds: [] }
  }
}

/** Cache a provider's working proxy for one day and remove any old block. */
export async function setProviderPreferredProxy(
  providerId: string,
  proxyId: string,
  ttlSeconds: number = FORWARD_PROXY_PREFERENCE_TTL_SECONDS
): Promise<boolean> {
  if (!providerId || !proxyId || !isRedisAvailable() || !redisClient) {
    return false
  }

  try {
    await redisClient
      .multi()
      .set(forwardProxyPreferenceKey(providerId), proxyId, 'EX', ttlSeconds)
      .srem(forwardProxyBlockedKey(providerId), proxyId)
      .exec()
    return true
  } catch (err) {
    console.warn(
      `⚠️  [Redis] Error caching proxy routing for "${providerId}":`,
      err instanceof Error ? err.message : err
    )
    return false
  }
}

/**
 * Provider-specific failure handling. The compare-and-delete prevents an old
 * failed request from deleting a newer preferred proxy written concurrently.
 */
export async function blockProviderProxy(
  providerId: string,
  proxyId: string,
  ttlSeconds: number = FORWARD_PROXY_FAILURE_TTL_SECONDS
): Promise<boolean> {
  if (!providerId || !proxyId || !isRedisAvailable() || !redisClient) {
    return false
  }

  const preferenceKey = forwardProxyPreferenceKey(providerId)
  const blockedKey = forwardProxyBlockedKey(providerId)
  const script = `
    if redis.call('GET', KEYS[1]) == ARGV[1] then
      redis.call('DEL', KEYS[1])
    end
    redis.call('SADD', KEYS[2], ARGV[1])
    redis.call('EXPIRE', KEYS[2], ARGV[2])
    return 1
  `

  try {
    await redisClient.eval(
      script,
      2,
      preferenceKey,
      blockedKey,
      proxyId,
      String(ttlSeconds)
    )
    return true
  } catch (err) {
    console.warn(
      `⚠️  [Redis] Error blocking proxy routing for "${providerId}":`,
      err instanceof Error ? err.message : err
    )
    return false
  }
}

/**
 * Store the latest provider health status in Redis so that on serverless
 * platforms (Vercel) every instance serves the same fresh snapshot.
 */
export async function setProviderStatus(
  status: unknown,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<boolean> {
  if (!isRedisAvailable() || !redisClient) {
    return false
  }
  try {
    await redisClient.set(
      PROVIDER_STATUS_KEY,
      JSON.stringify(status),
      'EX',
      ttlSeconds
    )
    return true
  } catch (err) {
    console.warn(
      `⚠️  [Redis] Error writing provider status:`,
      err instanceof Error ? err.message : err
    )
    return false
  }
}

/**
 * Retrieve the most recent provider health status from Redis.
 */
export async function getProviderStatus(): Promise<unknown | null> {
  if (!isRedisAvailable() || !redisClient) {
    return null
  }
  try {
    const rawData = await redisClient.get(PROVIDER_STATUS_KEY)
    return rawData ? (JSON.parse(rawData) as unknown) : null
  } catch (err) {
    console.warn(
      `⚠️  [Redis] Error reading provider status:`,
      err instanceof Error ? err.message : err
    )
    return null
  }
}

export interface CacheKeyOptions {
  providerId: string
  mediaType: 'movie' | 'tv'
  tmdbId: string
  season?: number
  episode?: number
  fProxyEnabled?: boolean
  proxyUrl?: string
}

/**
 * Builds a deterministic cache key for provider response queries
 */
export function buildProviderCacheKey(options: CacheKeyOptions): string {
  const {
    providerId,
    mediaType,
    tmdbId,
    season,
    episode,
    fProxyEnabled,
    proxyUrl,
  } = options
  const cleanProvider = providerId.toLowerCase().trim()

  let key = `${CACHE_PREFIX}${cleanProvider}:${mediaType}:${tmdbId}`
  if (mediaType === 'tv') {
    key += `:s${season || 0}:e${episode || 0}`
  }

  if (fProxyEnabled) {
    key += `:fProxy=true`
    if (proxyUrl) {
      const proxyHash = Buffer.from(proxyUrl).toString('base64url').slice(0, 16)
      key += `:${proxyHash}`
    }
  }

  return key
}

/**
 * Retrieve item from Redis cache safely
 */
export async function getProviderCache<T>(key: string): Promise<T | null> {
  if (!isRedisAvailable() || !redisClient) {
    return null
  }

  try {
    const rawData = await redisClient.get(key)
    if (!rawData) {
      return null
    }

    return JSON.parse(rawData) as T
  } catch (err) {
    console.warn(
      `⚠️  [Redis] Error reading cache key "${key}":`,
      err instanceof Error ? err.message : err
    )
    return null
  }
}

/**
 * Store item in Redis cache safely
 */
export async function setProviderCache<T>(
  key: string,
  data: T,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<boolean> {
  if (!isRedisAvailable() || !redisClient) {
    return false
  }

  try {
    await redisClient.set(key, JSON.stringify(data), 'EX', ttlSeconds)
    return true
  } catch (err) {
    console.warn(
      `⚠️  [Redis] Error writing cache key "${key}":`,
      err instanceof Error ? err.message : err
    )
    return false
  }
}

/**
 * Flush all provider cache keys (`flixquest:provider:*`)
 */
export async function flushProviderCache(): Promise<number> {
  if (!isRedisAvailable() || !redisClient) {
    return 0
  }

  try {
    const keys = await redisClient.keys(`${CACHE_PREFIX}*`)
    if (keys.length === 0) {
      return 0
    }

    const count = await redisClient.del(...keys)
    return count
  } catch (err) {
    console.warn(
      '⚠️  [Redis] Error flushing cache:',
      err instanceof Error ? err.message : err
    )
    return 0
  }
}

/**
 * Retrieve stats and health status of the Redis cache
 */
export async function getCacheStats(): Promise<{
  enabled: boolean
  connected: boolean
  defaultTtlSeconds: number
  providerKeysCount: number
}> {
  let providerKeysCount = 0

  if (isRedisAvailable() && redisClient) {
    try {
      const keys = await redisClient.keys(`${CACHE_PREFIX}*`)
      providerKeysCount = keys.length
    } catch {
      providerKeysCount = 0
    }
  }

  return {
    enabled: isCacheEnabled && (Boolean(redisUrl) || Boolean(redisHost)),
    connected: isConnected,
    defaultTtlSeconds: DEFAULT_TTL_SECONDS,
    providerKeysCount,
  }
}
