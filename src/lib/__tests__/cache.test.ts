import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted runs before vi.mock hoisting — so mock fns are available in the factory
const { mockGet, mockSetex, mockDel, mockKeys, mockOn } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSetex: vi.fn(),
  mockDel: vi.fn(),
  mockKeys: vi.fn(),
  mockOn: vi.fn(),
}))

vi.mock('ioredis', () => {
  return {
    default: class MockRedis {
      get = mockGet
      setex = mockSetex
      del = mockDel
      keys = mockKeys
      on = mockOn
    },
  }
})

// Import after mock setup
import {
  withCache,
  cacheInvalidate,
  cacheDelete,
  cacheGet,
  cacheSet,
  _resetForTesting,
  CACHE_KEYS,
} from '@/lib/cache'

describe('cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetForTesting()
    // Set REDIS_URL so getRedis() creates a client
    process.env.REDIS_URL = 'redis://localhost:6379'
  })

  describe('withCache', () => {
    it('returns cached data on cache hit', async () => {
      const cached = { foo: 'bar' }
      mockGet.mockResolvedValue(JSON.stringify(cached))

      const fetcher = vi.fn().mockResolvedValue({ foo: 'fresh' })
      const result = await withCache('test-key', 60, fetcher)

      expect(result).toEqual(cached)
      expect(fetcher).not.toHaveBeenCalled()
      expect(mockGet).toHaveBeenCalledWith('test-key')
    })

    it('calls fetcher and caches on cache miss', async () => {
      mockGet.mockResolvedValue(null)
      mockSetex.mockResolvedValue('OK')

      const fresh = { foo: 'fresh' }
      const fetcher = vi.fn().mockResolvedValue(fresh)
      const result = await withCache('test-key', 60, fetcher)

      expect(result).toEqual(fresh)
      expect(fetcher).toHaveBeenCalledOnce()
      expect(mockSetex).toHaveBeenCalledWith('test-key', 60, JSON.stringify(fresh))
    })

    it('falls back to fetcher when Redis is unavailable (REDIS_URL not set)', async () => {
      _resetForTesting()
      delete process.env.REDIS_URL

      const fresh = { data: 'direct' }
      const fetcher = vi.fn().mockResolvedValue(fresh)
      const result = await withCache('key', 60, fetcher)

      expect(result).toEqual(fresh)
      expect(fetcher).toHaveBeenCalledOnce()
      expect(mockGet).not.toHaveBeenCalled()
    })

    it('falls back to fetcher when Redis.get throws', async () => {
      mockGet.mockRejectedValue(new Error('connection refused'))
      mockSetex.mockResolvedValue('OK')

      const fresh = { fallback: true }
      const fetcher = vi.fn().mockResolvedValue(fresh)
      const result = await withCache('key', 60, fetcher)

      expect(result).toEqual(fresh)
      expect(fetcher).toHaveBeenCalledOnce()
    })

    it('still returns data when cache write fails', async () => {
      mockGet.mockResolvedValue(null)
      mockSetex.mockRejectedValue(new Error('write error'))

      const fresh = { ok: true }
      const fetcher = vi.fn().mockResolvedValue(fresh)
      const result = await withCache('key', 30, fetcher)

      expect(result).toEqual(fresh)
    })
  })

  describe('cacheInvalidate', () => {
    it('deletes matching keys', async () => {
      mockKeys.mockResolvedValue(['dashboard:user1', 'dashboard:user2'])
      mockDel.mockResolvedValue(2)

      await cacheInvalidate('dashboard:*')

      expect(mockKeys).toHaveBeenCalledWith('dashboard:*')
      expect(mockDel).toHaveBeenCalledWith('dashboard:user1', 'dashboard:user2')
    })

    it('does nothing when no keys match', async () => {
      mockKeys.mockResolvedValue([])

      await cacheInvalidate('nonexistent:*')

      expect(mockKeys).toHaveBeenCalledWith('nonexistent:*')
      expect(mockDel).not.toHaveBeenCalled()
    })

    it('silently ignores errors', async () => {
      mockKeys.mockRejectedValue(new Error('timeout'))

      await expect(cacheInvalidate('some:*')).resolves.toBeUndefined()
    })

    it('does nothing when REDIS_URL not set', async () => {
      _resetForTesting()
      delete process.env.REDIS_URL

      await cacheInvalidate('some:*')

      expect(mockKeys).not.toHaveBeenCalled()
    })
  })

  describe('cacheDelete', () => {
    it('deletes a single key', async () => {
      mockDel.mockResolvedValue(1)

      await cacheDelete('my-key')

      expect(mockDel).toHaveBeenCalledWith('my-key')
    })

    it('silently ignores errors', async () => {
      mockDel.mockRejectedValue(new Error('fail'))

      await expect(cacheDelete('key')).resolves.toBeUndefined()
    })

    it('does nothing when REDIS_URL not set', async () => {
      _resetForTesting()
      delete process.env.REDIS_URL

      await cacheDelete('key')

      expect(mockDel).not.toHaveBeenCalled()
    })
  })

  describe('cacheGet', () => {
    it('returns parsed value on hit', async () => {
      mockGet.mockResolvedValue(JSON.stringify({ val: 42 }))

      const result = await cacheGet<{ val: number }>('key')

      expect(result).toEqual({ val: 42 })
    })

    it('returns null on miss', async () => {
      mockGet.mockResolvedValue(null)

      const result = await cacheGet('key')

      expect(result).toBeNull()
    })

    it('returns null on error', async () => {
      mockGet.mockRejectedValue(new Error('fail'))

      const result = await cacheGet('key')

      expect(result).toBeNull()
    })

    it('returns null when REDIS_URL not set', async () => {
      _resetForTesting()
      delete process.env.REDIS_URL

      const result = await cacheGet('key')

      expect(result).toBeNull()
    })
  })

  describe('cacheSet', () => {
    it('sets value with TTL', async () => {
      mockSetex.mockResolvedValue('OK')

      await cacheSet('key', { data: 'hello' }, 120)

      expect(mockSetex).toHaveBeenCalledWith('key', 120, JSON.stringify({ data: 'hello' }))
    })

    it('silently ignores errors', async () => {
      mockSetex.mockRejectedValue(new Error('fail'))

      await expect(cacheSet('key', 'val', 60)).resolves.toBeUndefined()
    })

    it('does nothing when REDIS_URL not set', async () => {
      _resetForTesting()
      delete process.env.REDIS_URL

      await cacheSet('key', 'val', 60)

      expect(mockSetex).not.toHaveBeenCalled()
    })
  })

  describe('CACHE_KEYS', () => {
    it('has all expected key patterns', () => {
      expect(CACHE_KEYS).toEqual({
        dashboard: 'dashboard:*',
        tasks: 'tasks:*',
        projects: 'projects:*',
        warehouse: 'warehouse:*',
        admin: 'admin:*',
      })
    })
  })
})
