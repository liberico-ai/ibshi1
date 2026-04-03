# Step 1 Context: Testing Infrastructure Setup

> **Status:** COMPLETED
> **Date:** 2026-04-02
> **Branch:** main (direct, not yet PR'd)

---

## What Was Done

1. **Installed dev dependencies:**
   - `vitest@4.1.2` — test runner
   - `@vitest/coverage-v8` — coverage with V8 provider
   - `vitest-mock-extended` — deep mocking for Prisma client

2. **Created `vitest.config.ts`** at project root:
   - Path alias `@/` → `src/` (matches tsconfig.json `"@/*": ["./src/*"]`)
   - `globals: true` — no need to import `describe/it/expect` in test files
   - Coverage: `text` + `lcov` reporters, scoped to `src/lib/**/*.ts`
   - Test pattern: `src/**/__tests__/**/*.test.ts`

3. **Created `src/lib/__mocks__/db.ts`** — Prisma client mock:
   - Exports `prismaMock` (deep mock of PrismaClient)
   - Auto-resets before each test via `beforeEach(mockReset)`
   - Auto-mocks `@/lib/db` module (both `prisma` and `default` exports)
   - Type: `DeepMockProxy<PrismaClient>` exported as `MockPrismaClient`

4. **Added scripts to `package.json`:**
   - `"test": "vitest run"` — single run
   - `"test:watch": "vitest"` — watch mode
   - `"test:coverage": "vitest run --coverage"` — with coverage report

5. **Created `src/lib/__tests__/utils.test.ts`** — 20 test cases covering:
   - `cn()` — class merge, conflicts, falsy values
   - `formatCurrency()` — VND, USD, null, string input
   - `formatDate()` — DD/MM/YYYY format, null, Date object
   - `getStatusColor()` — all statuses + unknown
   - `getStatusBg()` — all statuses + unknown
   - `getUrgencyLabel()` — all urgency levels + unknown
   - `getProgressColor()` — all boundary values (0, 24, 25, 49, 50, 79, 80, 100)

---

## Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `package.json` | Modified | Added test/test:watch/test:coverage scripts + dev deps |
| `package-lock.json` | Modified | Lockfile updated |
| `vitest.config.ts` | **NEW** | Vitest configuration |
| `src/lib/__mocks__/db.ts` | **NEW** | Prisma mock for unit tests |
| `src/lib/__tests__/utils.test.ts` | **NEW** | Smoke tests for utils.ts |

---

## How to Use the Prisma Mock (for Steps 2-5)

```typescript
// In any test file that needs database mocking:
import { prismaMock } from '@/lib/__mocks__/db'

// The import above automatically:
// 1. Creates a deep mock of PrismaClient
// 2. Mocks '@/lib/db' so any import of prisma uses the mock
// 3. Resets all mock state before each test

// Example: mock a Prisma query
prismaMock.workflowTask.findMany.mockResolvedValue([
  { id: '1', stepCode: 'P1.1', status: 'IN_PROGRESS', /* ... */ }
])

// Example: mock a transaction
prismaMock.$transaction.mockImplementation(async (fn) => {
  return fn(prismaMock)
})
```

---

## Verification Results

- `npm test` — **20 tests passed** (240ms)
- `npm run test:coverage` — report generates, `utils.ts` at 97% coverage
- `npm run build` — passes (no regressions)

---

## Important Notes for Next Steps

1. **Path alias:** Always use `@/lib/...` imports in test files — the alias is configured in both `tsconfig.json` and `vitest.config.ts`
2. **Test file location:** Place tests in `src/lib/__tests__/<module>.test.ts`
3. **Prisma mock import:** Import `prismaMock` from `@/lib/__mocks__/db` — this auto-mocks the `prisma` export
4. **No DB needed for unit tests:** The mock intercepts all Prisma calls. Only integration tests (Step 10) need a real database.
5. **Global test functions:** `describe`, `it`, `expect`, `vi` are globally available (no import needed) thanks to `globals: true`
6. **Coverage baseline:** Currently 5.47% overall — will increase as Steps 2-5 add engine tests
