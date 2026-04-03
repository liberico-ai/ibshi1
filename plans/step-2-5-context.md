# Steps 2-5 Context: Unit Tests for All Business Engines

> **Status:** COMPLETED
> **Date:** 2026-04-02
> **Executed:** 4 parallel agents (worktree isolation)

---

## Summary

| Step | Module | Test File | Tests | Coverage Target |
|------|--------|-----------|-------|-----------------|
| 2 | workflow-engine | `src/lib/__tests__/workflow-engine.test.ts` | 39 | 80%+ |
| 3 | salary-engine | `src/lib/__tests__/salary-engine.test.ts` | 36 | 90%+ |
| 4 | sync-engine | `src/lib/__tests__/sync-engine.test.ts` | 28 | 80%+ |
| 5 | task-engine | `src/lib/__tests__/task-engine.test.ts` | 17 | 80%+ |
| — | utils (Step 1) | `src/lib/__tests__/utils.test.ts` | 20 | 97% |
| **Total** | | | **140** | |

---

## Mock Pattern (IMPORTANT for future steps)

All test files use this pattern — **do NOT use any other approach:**

```typescript
// ── Correct way to mock Prisma ──
import { prismaMock } from '@/lib/__mocks__/db'

// This auto-mocks '@/lib/db' (both `prisma` and `default` exports)
// And resets all mocks before each test via beforeEach(mockReset)

// Then mock your Prisma calls:
prismaMock.workflowTask.findUnique.mockResolvedValue({ ... } as never)
prismaMock.$transaction.mockImplementation(async (fn) => fn(prismaMock))
```

**Anti-patterns that WILL FAIL:**
```typescript
// ❌ DO NOT: define prismaMock before vi.mock — hoisting breaks it
const prismaMock = mockDeep<PrismaClient>()
vi.mock('@/lib/db', () => ({ default: prismaMock }))

// ❌ DO NOT: use vi.hoisted with require — ESM/CJS conflict
vi.hoisted(() => { const { mockDeep } = require('vitest-mock-extended') })

// ❌ DO NOT: use vi.mock('@/lib/db') without factory then import default
vi.mock('@/lib/db')
import prismaMock from '@/lib/__mocks__/db'  // gets module, not prismaMock
```

---

## What Each Test Suite Covers

### workflow-engine.test.ts (39 tests)
- `initializeProjectWorkflow()` — creates 36 tasks, activates P1.1, sets deadlines
- `activateTask()` — status change, deadline calc, notifications
- `completeTask()` — marks DONE, saves resultData, activates next steps, runs sync hooks (BOM/PO/GRN), gate checking
- `rejectTask()` — marks REJECTED, resets intermediate steps, reactivates target, runs reverse hooks, logs ChangeEvent
- `checkGate()` — prerequisite validation (blocks/passes)
- Edge cases: already completed, PENDING task, missing data, override reject target

**Mocked dependencies:**
- `@/lib/db` (Prisma)
- `@/lib/sync-engine` (syncBOMtoBudget, syncPOtoBudget, syncGRNtoBudget, runReverseHooks)

### salary-engine.test.ts (36 tests)
- `calculateInsurance()` — employee/employer rates, salary cap, zero salary
- `calculateDeduction()` — self deduction, per-dependent deduction
- `calculateTax()` — all 7 progressive brackets with boundary values
- `calculateSalary()` — pro-rata, OT, piece-rate, allowances, advance, dependents, combined scenarios
- `calculateMonthlySalary()` — employee not found, full calc with attendance/contract/piece-rate, defaults

**Mocked dependencies:**
- `@/lib/db` (Prisma)

### sync-engine.test.ts (28 tests)
- `logChangeEvent()` — all fields, optional fields
- `syncBOMtoBudget()` — update existing, create new, null unitPrice
- `syncPOtoBudget()` — increment, PO not found, no totalValue
- `syncGRNtoBudget()` — increment actual, no budget
- `syncECOcascade()` — approved cascade, not approved, not found
- `reverseStockMovement()` — creates reverse, no movement
- `reverseMaterialIssue()` — return material, no work order
- `reverseDelivery()` — mark RETURNED, no delivery
- `reverseWOstatus()` — set REWORK, no work order
- `recalcBudgetActual()` — sum & update, no budget
- `runReverseHooks()` — dispatching per step code, error handling

**Mocked dependencies:**
- `@/lib/db` (Prisma)

### task-engine.test.ts (17 tests)
- `getTaskInbox()` — L1/L2 assignment, excludes completed, ordering
- `getTasksByProject()` — filters by project
- `getTaskById()` — includes relations
- `assignTask()` — L1→L2
- `getDashboardStats()` — counts per status, role filtering
- `getBottleneckMap()` — sorted by pending count
- `checkDeadlines()` — overdue detection, notification creation
- `getModuleStats()` — warehouse/production/QC counts

**Mocked dependencies:**
- `@/lib/db` (Prisma)

---

## Verification Results

```
npm test → 140 passed (252ms)
npm run build → passes (no regressions)
npm run test:coverage → generates coverage report
```

---

## Important Notes for Next Steps

1. **Mock pattern is standardized** — use `import { prismaMock } from '@/lib/__mocks__/db'` only
2. **`as never` type cast** — used for mock return values to avoid TypeScript strict typing issues with Prisma
3. **`$transaction` mocking** — use `prismaMock.$transaction.mockImplementation(async (fn) => fn(prismaMock))`
4. **sync-engine is mocked in workflow-engine tests** — if sync-engine API changes, update workflow-engine tests too
5. **salary-config exports** are pure functions — tested directly without mocking
6. **No DB needed** — all tests use mocks. Integration tests (Step 10) will test with real DB.
