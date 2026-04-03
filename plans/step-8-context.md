# Step 8 Context: Redis Caching

> **Status:** COMPLETED
> **Date:** 2026-04-02
> **Tests:** 185 total (added 20 cache tests)

---

## Summary

Redis caching layer with cache-aside pattern, graceful degradation when Redis is unavailable, and integration into 10 API routes.

---

## Files Added

### `src/lib/cache.ts` — Core caching module
- **Lazy singleton**: `getRedis()` creates Redis client on first call. If `REDIS_URL` not set or connection fails, returns `null` (graceful degradation).
- **`withCache<T>(key, ttlSeconds, fetcher)`**: Cache-aside pattern. Checks cache first, falls back to fetcher on miss/error, writes result to cache.
- **`cacheInvalidate(pattern)`**: Deletes all keys matching a glob pattern (e.g., `dashboard:*`).
- **`cacheDelete(key)`**: Deletes a single cache key.
- **`cacheGet<T>(key)`**: Gets and parses a single cached value.
- **`cacheSet(key, value, ttlSeconds)`**: Sets a single value with TTL.
- **`CACHE_KEYS`**: Predefined invalidation patterns: `dashboard:*`, `tasks:*`, `projects:*`, `warehouse:*`, `admin:*`.
- **`_resetForTesting()`**: Resets singleton state for test isolation.

### `src/lib/__tests__/cache.test.ts` — 20 tests
- Tests all public functions with Redis available and unavailable.
- Mock pattern: `vi.hoisted()` + class-based mock (NOT `vi.fn().mockImplementation()`).

### `docker-compose.prod.yml` — Updated
- Added `redis:7-alpine` service with volume persistence.
- Added `REDIS_URL=redis://redis:6379` to app environment.
- Added `redis-data` volume.

---

## API Routes Modified

### Routes with `withCache` (read caching)

| Route | Cache Key Pattern | TTL |
|-------|------------------|-----|
| `GET /api/dashboard` | `dashboard:{userId}` | 60s |
| `GET /api/dashboard/role` | `dashboard:role:{roleCode}:{userId}` | 60s |
| `GET /api/tasks` | `tasks:inbox:{userId}` | 30s |
| `GET /api/projects` | `projects:list:{userId}:{status}:{search}:{page}:{limit}` | 60s |
| `GET /api/admin/stats` | `admin:stats` | 120s |
| `GET /api/warehouse/stats` | `warehouse:stats` | 60s |

### Routes with `cacheInvalidate` (write-through invalidation)

| Route | Action | Invalidated Keys |
|-------|--------|-----------------|
| `POST /api/projects` | Create project | `projects:*` |
| `PUT /api/projects/[id]` | Update project | `projects:*` |
| `POST /api/projects/[id]` (close) | Close project | `projects:*`, `dashboard:*` |
| `PUT /api/tasks/[id]` | Complete task | `dashboard:*`, `tasks:*` |
| `POST /api/tasks/[id]/reject` | Reject task | `dashboard:*`, `tasks:*` |
| `POST /api/stock-movements` | Stock movement | `warehouse:*` |

---

## Mock Pattern for ioredis (IMPORTANT)

```typescript
// Use vi.hoisted() + class-based mock — NOT vi.fn().mockImplementation()
const { mockGet, mockSetex, mockDel, mockKeys, mockOn } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSetex: vi.fn(),
  mockDel: vi.fn(),
  mockKeys: vi.fn(),
  mockOn: vi.fn(),
}))

vi.mock('ioredis', () => ({
  default: class MockRedis {
    get = mockGet
    setex = mockSetex
    del = mockDel
    keys = mockKeys
    on = mockOn
  },
}))
```

**Why class-based**: `vi.fn().mockImplementation(() => ({...}))` triggers Vitest warning about non-function/class constructor and doesn't properly bind methods when used with `new`.

---

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `REDIS_URL` | Redis connection string | Not set (caching disabled) |

---

## Impact on Other Steps

- **Step 6 (Zod)**: Cache wrapping is independent of validation. Zod validation should happen BEFORE `withCache` (validate input → cache key → fetch).
- **Step 7 (Security)**: Compatible. Rate limiting in middleware runs before route handlers; caching runs inside handlers.
- **Step 9 (OpenAPI)**: Cache does not affect API schemas. Response shapes unchanged.
- **Testing**: All cache functions gracefully degrade when `REDIS_URL` is unset, so existing tests without Redis continue to work.
