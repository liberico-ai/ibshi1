import Redis from 'ioredis'

// Lazy singleton — only connects when first used (same pattern as db.ts)
let redis: Redis | null = null
let connectionFailed = false

function getRedis(): Redis | null {
  if (connectionFailed) return null
  if (redis) return redis

  const url = process.env.REDIS_URL
  if (!url) {
    connectionFailed = true
    console.warn('[cache] REDIS_URL not set — caching disabled')
    return null
  }

  try {
    redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: 3000,
    })
    redis.on('error', (err) => {
      console.warn('[cache] Redis error:', err.message)
      connectionFailed = true
      redis = null
    })
    return redis
  } catch {
    connectionFailed = true
    return null
  }
}

/** Reset internal state — only for testing */
export function _resetForTesting(): void {
  redis = null
  connectionFailed = false
}

// Cache key patterns for invalidation
export const CACHE_KEYS = {
  dashboard: 'dashboard:*',
  tasks: 'tasks:*',
  projects: 'projects:*',
  warehouse: 'warehouse:*',
  admin: 'admin:*',
}

/**
 * Cache-aside pattern: check cache first, fall back to fetcher.
 * Gracefully degrades when Redis is unavailable.
 */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const client = getRedis()
  if (!client) return fetcher() // graceful fallback

  try {
    const cached = await client.get(key)
    if (cached) return JSON.parse(cached) as T
  } catch {
    /* fallback to fetcher */
  }

  const data = await fetcher()

  try {
    await client.setex(key, ttlSeconds, JSON.stringify(data))
  } catch {
    /* ignore cache write failures */
  }

  return data
}

/** Delete all keys matching a glob pattern (e.g. 'dashboard:*') */
export async function cacheInvalidate(pattern: string): Promise<void> {
  const client = getRedis()
  if (!client) return
  try {
    const keys = await client.keys(pattern)
    if (keys.length > 0) await client.del(...keys)
  } catch {
    /* ignore */
  }
}

/** Delete a single cache key */
export async function cacheDelete(key: string): Promise<void> {
  const client = getRedis()
  if (!client) return
  try {
    await client.del(key)
  } catch {
    /* ignore */
  }
}

/** Get a single value from cache */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const client = getRedis()
  if (!client) return null
  try {
    const cached = await client.get(key)
    if (cached) return JSON.parse(cached) as T
    return null
  } catch {
    return null
  }
}

/** Set a single value in cache */
export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  const client = getRedis()
  if (!client) return
  try {
    await client.setex(key, ttlSeconds, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}
