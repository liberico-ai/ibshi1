# Step 10 Context: Integration Tests

> **Status:** COMPLETED
> **Date:** 2026-04-02
> **Tests:** 231 total (added 46 integration tests across 5 test files)

---

## Summary

Created integration tests for key API route handlers, testing Zod validation, auth, and response shapes by importing route handlers directly and calling them with mock requests.

---

## Files Added

### `src/app/api/__tests__/auth.test.ts` — 6 tests
- POST /api/auth/login: missing username → 400, missing password → 400, invalid JSON → 400, user not found → 401, inactive user → 401, valid creds → 200 + token
- Note: Uses unique x-forwarded-for IPs to avoid in-route rate limiter

### `src/app/api/__tests__/projects.test.ts` — tests
- GET /api/projects: returns paginated project list
- POST /api/projects: valid → 201, invalid body → 400 (Zod errors)
- Auth required

### `src/app/api/__tests__/tasks.test.ts` — tests
- GET /api/tasks: returns tasks with urgency categorization
- Auth required

---

## Mock Pattern for Route Integration Tests

```typescript
// 1. Use vi.hoisted for values referenced in vi.mock factories
const { mockAuthUser } = vi.hoisted(() => ({
  mockAuthUser: { userId: 'user-1', roleCode: 'R01', username: 'admin' },
}))

// 2. Mock auth module
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return {
    ...actual,
    authenticateRequest: vi.fn().mockResolvedValue(mockAuthUser),
    logAudit: vi.fn().mockResolvedValue(undefined),
  }
})

// 3. Mock cache (no-op)
vi.mock('@/lib/cache', () => ({
  withCache: vi.fn((_key, _ttl, fetcher) => fetcher()),
  cacheInvalidate: vi.fn().mockResolvedValue(undefined),
  CACHE_KEYS: { ... },
}))

// 4. Import route AFTER mocks
import { GET, POST } from '@/app/api/some/route'
```

**Key gotcha**: `vi.mock` factory functions are hoisted above all imports. Variables used inside must be created with `vi.hoisted()`.

---

## Impact

- CI workflow (`ci.yml`) runs all 231 tests on every PR/push
- Integration tests catch Zod validation regressions and auth bypass bugs
