import { Redis, RedisOptions } from 'ioredis'

const DEFAULT_TTL_SECONDS = Number(process.env.REDIS_CACHE_TTL) || 7200 // 2 hours default
const CACHE_PREFIX = 'flixquest:provider:'
const PROVIDER_STATUS_KEY = 'flixquest:provider-status'

const isCacheEnabled = process.env.REDIS_CACHE_ENABLED !== 'false'
const redisUrl = process.env.REDIS_URL
const redisHost = process.env.REDIS_HOST
const redisPort = Number(process.env.REDIS_PORT) || 6379
const redisPassword = process.env.REDIS_PASSWORD

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
