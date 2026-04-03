# Blueprint: IBS ERP Comprehensive Improvement

> **Objective:** Add unit tests, Redis caching, Zod API validation, OpenAPI documentation, and security hardening to the IBS ERP Production system.
>
> **Generated:** 2026-04-02
> **Repository:** liberico-ai/ibshi1
> **Base branch:** main
> **Steps:** 14 (5 parallel groups)
> **Estimated PRs:** 14

---

## Dependency Graph

```
[1] Testing Infrastructure
 │
 ├──[2] Unit: workflow-engine  ──┐
 ├──[3] Unit: salary-engine      ├─ PARALLEL GROUP A
 ├──[4] Unit: sync-engine        │
 ├──[5] Unit: task-engine  ──────┘
 │
 ├──[6a] Zod schemas + helpers  ──┐
 ├──[7] Security hardening        ├─ PARALLEL GROUP B (all depend on 1 only)
 └──[8] Redis caching layer  ─────┘
         │
    [6b] Zod: migrate auth/admin/dashboard routes  (depends on 6a)
         │
    [6c] Zod: migrate domain routes  (depends on 6b)
         │
    [9]  OpenAPI/Swagger docs  (depends on 6c, 7)
         │
    [10] Integration tests  (depends on 6c, 7, 8)
         │
    [11] E2E test expansion  (depends on 10)
         │
    [12] CI/CD pipeline + final verification  (depends on 9, 10, 11)
```

> **Critical path:** 1 → 6a → 6b → 6c → 10 → 11 → 12
> **Max parallelism:** 7 concurrent (steps 2-5 + 6a + 7 + 8 all after step 1)

---

## Invariants (verified after every step)

1. `npm run build` passes with zero errors
2. `npx prisma validate` passes
3. No new TypeScript errors (`npx tsc --noEmit`)
4. `npm run lint` passes
5. No secrets committed (no `.env` values in diff)

> **Note:** E2E tests (`npx playwright test`) are verified only from Step 11 onward.
> An existing `e2e/workflow.spec.ts` file exists but may not pass without proper DB seeding — do not treat it as an invariant until Step 11 configures globalSetup.

---

## Step 1: Testing Infrastructure Setup

- **Branch:** `feat/testing-infrastructure`
- **Depends on:** none
- **Model tier:** default
- **Parallel group:** —

### Context Brief

The project has zero unit tests. One Playwright E2E file exists (`e2e/workflow.spec.ts`) but may not pass without DB seeding. Zod is installed but unused. No Jest/Vitest configured. This step sets up Vitest as the test runner with proper TypeScript, path aliases, and Prisma mock support.

### Tasks

1. Install dev dependencies:
   ```bash
   npm install -D vitest @vitest/coverage-v8 vitest-mock-extended
   ```
2. Create `vitest.config.ts` at project root:
   - Resolve `@/` path alias to `src/`
   - Set `globals: true`
   - Coverage reporter: `text`, `lcov`
   - Exclude `node_modules`, `e2e/`, `.next/`
3. Create `src/lib/__mocks__/db.ts` — Prisma client mock using `vitest-mock-extended`
4. Add scripts to `package.json`:
   ```json
   "test": "vitest run",
   "test:watch": "vitest",
   "test:coverage": "vitest run --coverage"
   ```
5. Create `src/lib/__tests__/utils.test.ts` — smoke test that imports and tests a utility function
6. Verify: `npm test` runs and passes

### Verification

```bash
npm test
npm run build
```

### Exit Criteria

- `npm test` runs successfully with 1+ passing test
- Coverage report generates
- `npm run build` still passes
- PR merged to main

### Rollback

```bash
git revert <commit-sha>
npm install  # restore package-lock
```

---

## Step 2: Unit Tests — Workflow Engine

- **Branch:** `test/workflow-engine`
- **Depends on:** Step 1
- **Model tier:** strongest (Opus) — complex 36-step workflow logic
- **Parallel group:** A (steps 2-5)

### Context Brief

`src/lib/workflow-engine.ts` orchestrates a 36-step project workflow. Key functions: `initializeProjectWorkflow()`, `completeTask()`, `rejectTask()`, `activateTask()`, `checkGate()`, `runWorkflowHooks()`. It creates WorkflowTask records, manages forward sync hooks (BOM→Budget, PO→Budget, GRN→Stock), and reverse hooks on rejection. `src/lib/workflow-constants.ts` defines the 36 steps with phase labels, assigned roles, dependencies, and gate rules.

### Tasks

1. Create `src/lib/__tests__/workflow-engine.test.ts`
2. Mock Prisma client and sync-engine dependencies
3. Test `initializeProjectWorkflow()`:
   - Creates exactly 36 tasks
   - First task (P1.1) activated, rest pending
   - Each task has correct role assignment from workflow-constants
4. Test `completeTask()`:
   - Marks task COMPLETED
   - Activates next dependent tasks
   - Runs forward sync hooks (mock and verify calls)
5. Test `rejectTask()`:
   - Returns to previous step
   - Resets intermediate steps to PENDING
   - Calls reverse hooks
6. Test `checkGate()`:
   - Returns true when all prerequisites completed
   - Returns false when any prerequisite pending
7. Test `activateTask()`:
   - Sets status to IN_PROGRESS
   - Sets deadline
8. Test edge cases:
   - Complete already-completed task
   - Reject first task (no previous step)
   - Gate with mixed prerequisite states

### Verification

```bash
npm test -- src/lib/__tests__/workflow-engine.test.ts
npm run test:coverage
```

### Exit Criteria

- 15+ test cases passing
- Coverage ≥ 80% for workflow-engine.ts
- All invariants pass
- PR merged to main

### Rollback

```bash
git revert <commit-sha>
```

---

## Step 3: Unit Tests — Salary Engine

- **Branch:** `test/salary-engine`
- **Depends on:** Step 1
- **Model tier:** strongest (Opus) — Vietnamese labor law calculations
- **Parallel group:** A (steps 2-5)

### Context Brief

`src/lib/salary-engine.ts` calculates monthly salaries per Vietnamese labor law. Components: base salary (pro-rata), OT (1.5x), piece-rate bonuses, fuel/meal allowances, insurance deductions (BHXH 8%, BHYT 1.5%, BHTN 1%), progressive income tax. `src/lib/salary-config.ts` defines rates and thresholds. Key functions: `calculateSalary()`, `calculateMonthlySalary()`, `calculateAllSalaries()`, `saveSalaryRecords()`.

### Tasks

1. Create `src/lib/__tests__/salary-engine.test.ts`
2. Create `src/lib/__tests__/salary-config.test.ts`
3. Test `calculateSalary()` (pure calculation, no DB):
   - Standard 22-day month, no OT → correct base salary
   - Partial month (15/22 days) → pro-rated correctly
   - With OT hours → 1.5x rate applied
   - With piece-rate income → added to gross
4. Test allowances:
   - Fuel allowance triggered when distance > threshold
   - Meal allowance applied correctly
   - Contract allowances included
5. Test deductions:
   - BHXH 8% of base salary
   - BHYT 1.5% of base salary
   - BHTN 1% of base salary
   - Total insurance = 10.5%
6. Test progressive tax brackets:
   - Income below personal deduction → 0 tax
   - Each bracket boundary (5M, 10M, 18M, 32M, 52M, 80M)
7. Test net salary = gross - insurance - tax
8. Test `calculateMonthlySalary()` with mocked Prisma (attendance, contracts, piece-rate queries)

### Verification

```bash
npm test -- src/lib/__tests__/salary-engine.test.ts
npm run test:coverage
```

### Exit Criteria

- 20+ test cases covering all salary components
- Coverage ≥ 90% for salary-engine.ts (pure calculation — should be fully testable)
- Tax bracket boundaries verified
- PR merged to main

### Rollback

```bash
git revert <commit-sha>
```

---

## Step 4: Unit Tests — Sync Engine

- **Branch:** `test/sync-engine`
- **Depends on:** Step 1
- **Model tier:** default
- **Parallel group:** A (steps 2-5)

### Context Brief

`src/lib/sync-engine.ts` handles forward and reverse data synchronization. Forward: `syncBOMtoBudget()`, `syncPOtoBudget()`, `syncGRNtoBudget()`, `syncECOcascade()`. Reverse: `reverseStockMovement()`, `reverseMaterialIssue()`, `reverseDelivery()`, `reverseWOstatus()`, `recalcBudgetActual()`. Also: `logChangeEvent()` for audit trail.

### Tasks

1. Create `src/lib/__tests__/sync-engine.test.ts`
2. Test forward sync:
   - `syncBOMtoBudget()`: BOM items × unit price → Budget.planned
   - `syncPOtoBudget()`: PO total → Budget.committed
   - `syncGRNtoBudget()`: GRN amount → Budget.actual
   - `syncECOcascade()`: ECO → recalc BOM → recalc Budget
3. Test reverse hooks:
   - `reverseStockMovement()`: creates opposite movement, adjusts stock qty
   - `reverseMaterialIssue()`: returns material, updates stock
   - `reverseDelivery()`: marks RETURNED
   - `reverseWOstatus()`: marks REWORK
   - `recalcBudgetActual()`: sums non-reversed transactions
4. Test `logChangeEvent()`:
   - Creates ChangeEvent with correct type (REJECT/SYNC/REWORK)
   - Includes before/after snapshots
5. Test `runReverseHooks()` dispatcher:
   - Correct hook called per step code

### Verification

```bash
npm test -- src/lib/__tests__/sync-engine.test.ts
```

### Exit Criteria

- 15+ test cases
- Coverage ≥ 80% for sync-engine.ts
- PR merged to main

### Rollback

```bash
git revert <commit-sha>
```

---

## Step 5: Unit Tests — Task Engine

- **Branch:** `test/task-engine`
- **Depends on:** Step 1
- **Model tier:** default
- **Parallel group:** A (steps 2-5)

### Context Brief

`src/lib/task-engine.ts` manages task inbox and dashboard aggregation. Functions: `getTaskInbox()`, `getTasksByProject()`, `getTaskById()`, `assignTask()`, `getDashboardStats()`, `getProjectsOverview()`, `getBottleneckMap()`, `checkDeadlines()`, `getModuleStats()`.

### Tasks

1. Create `src/lib/__tests__/task-engine.test.ts`
2. Test `getTaskInbox()`:
   - Returns tasks matching user's role (L1 assignment)
   - Returns tasks assigned to specific user (L2)
   - Excludes completed tasks
3. Test `getDashboardStats()`:
   - Correct counts for pending/in-progress/completed/overdue
4. Test `getBottleneckMap()`:
   - Identifies role with most pending tasks
5. Test `assignTask()`:
   - L1→L2 assignment updates assignee
6. Test `checkDeadlines()`:
   - Identifies overdue tasks (deadline < now)
   - Creates notifications for assignees
7. Test `getModuleStats()`:
   - Correct counts for materials, work orders, inspections

### Verification

```bash
npm test -- src/lib/__tests__/task-engine.test.ts
```

### Exit Criteria

- 12+ test cases
- Coverage ≥ 80% for task-engine.ts
- PR merged to main

### Rollback

```bash
git revert <commit-sha>
```

---

## Step 6a: Zod Schemas + Validation Helpers

- **Branch:** `feat/zod-schemas`
- **Depends on:** Step 1
- **Model tier:** strongest (Opus) — schema design requires understanding all 52 Prisma models
- **Parallel group:** B (steps 2-5, 6a, 7, 8)

### Context Brief

82 API routes exist under `src/app/api/` (82 `route.ts` files). None use Zod validation — all do manual `if (!field)` checks. Zod 4.3.6 is already installed but unused. This step creates the schemas and helpers only — migration happens in 6b/6c.

### Tasks

1. Create `src/lib/schemas/` directory with files per domain:
   - `auth.schema.ts` — login input
   - `user.schema.ts` — create/update user
   - `project.schema.ts` — create/update project
   - `task.schema.ts` — create/update/reject/comment
   - `material.schema.ts` — material, stock movement
   - `procurement.schema.ts` — PR, PO, GRN
   - `production.schema.ts` — work order, job card, material issue
   - `qc.schema.ts` — inspection, ITP, NCR, certificate
   - `design.schema.ts` — drawing, BOM, ECO
   - `hr.schema.ts` — employee, attendance, salary, contract, piece-rate
   - `finance.schema.ts` — invoice, payment, budget, cashflow
   - `common.schema.ts` — shared types (pagination, ID params, date ranges)
   - `index.ts` — barrel export
2. Create `src/lib/api-helpers.ts`:
   - `validateBody<T>(request, schema)` — parse body with Zod, return typed result or 400 error
   - `validateQuery<T>(url, schema)` — parse search params
   - `validateParams<T>(params, schema)` — parse route params
3. Add unit tests for validation helpers
4. Add unit tests for critical schemas (edge cases, boundary values)
5. **Do NOT migrate any existing routes yet** — that happens in 6b/6c

### Verification

```bash
npm test -- src/lib/__tests__/api-helpers.test.ts
npm run build
```

### Exit Criteria

- All schema files created with correct types matching Prisma models
- `validateBody/Query/Params` helpers tested
- `npm run build` passes
- PR merged to main

### Rollback

```bash
git revert <commit-sha>
```

---

## Step 6b: Zod Migration — Auth, Admin, Dashboard Routes

- **Branch:** `feat/zod-migrate-core`
- **Depends on:** Step 6a
- **Model tier:** default
- **Parallel group:** —

### Context Brief

Step 6a created Zod schemas and `validateBody/Query/Params` helpers. This step migrates the core routes (~15 files): auth, users, admin, dashboard, departments, notifications, upload. These are lower-risk routes to validate the pattern before mass migration.

### Tasks

1. Migrate these route files to use `validateBody()`:
   - `api/auth/login` — use `loginSchema`
   - `api/users` POST — use `createUserSchema`
   - `api/users/[id]` PUT — use `updateUserSchema`
   - `api/users/[id]/reset-password` POST
   - `api/admin/config` POST
   - `api/departments` POST
   - `api/notifications` POST
   - `api/upload` POST
   - `api/projects` POST — use `createProjectSchema`
   - `api/projects/[id]` PUT
   - `api/tasks` POST — use `createTaskSchema`
   - `api/tasks/[id]` PUT
   - `api/tasks/[id]/comments` POST
   - `api/tasks/[id]/reject` POST
   - `api/tasks/activate` POST
2. Remove manual `if (!field)` checks replaced by schemas
3. Verify each migrated route returns structured Zod errors on invalid input

### Verification

```bash
npm run build
npm test
# Manual: POST invalid data to /api/auth/login → expect 400 with Zod error details
```

### Exit Criteria

- ~15 core routes migrated to Zod validation
- Manual validation removed from migrated routes
- Build passes, no regressions
- PR merged to main

### Rollback

```bash
git revert <commit-sha>
```

---

## Step 6c: Zod Migration — Domain Routes (Warehouse, Production, QC, HR, Finance, Design)

- **Branch:** `feat/zod-migrate-domain`
- **Depends on:** Step 6b
- **Model tier:** strongest (Opus) — large diff across ~67 remaining routes
- **Parallel group:** —

### Context Brief

Step 6b migrated ~15 core routes. This step migrates the remaining ~67 domain routes across warehouse, production, QC, HR, finance, design, safety, delivery, subcontracts, reports, milestones, lessons. Use the same `validateBody()` pattern established in 6b.

### Tasks

1. Migrate all remaining POST/PUT routes by domain:
   - **Warehouse:** materials, purchase-requests, purchase-orders, grn, stock-movements, vendors, mill-certificates
   - **Production:** production, job-cards, workshops
   - **QC:** qc, itp, ncr, certificates, mrb
   - **Design:** design, drawings, bom, eco
   - **HR:** employees, attendance, timesheets, salary, contracts, piece-rate-contracts, piece-rate-output
   - **Finance:** invoices, payments, budgets, cashflow-entries
   - **Other:** safety, delivery, lessons, milestones, subcontracts
2. Remove all manual `if (!field)` validation from migrated routes
3. Ensure GET routes with query params use `validateQuery()` where appropriate

### Verification

```bash
npm run build
npm test
# Grep for remaining manual validation: grep -r "if (!.*body\." src/app/api/ → expect 0 results
```

### Exit Criteria

- All 82 API routes use Zod validation for input
- Zero manual `if (!field)` checks remain in route files
- Build passes
- PR merged to main

### Rollback

```bash
git revert <commit-sha>
```

---

## Step 7: Security Hardening

- **Branch:** `feat/security-hardening`
- **Depends on:** Step 1
- **Model tier:** default — tasks are straightforward middleware/config changes
- **Parallel group:** B (steps 2-5, 6a, 7, 8)

### Context Brief

Current security: JWT auth (solid), bcryptjs (salt 12), security headers (X-Frame, HSTS, nosniff), Prisma (prevents SQLi). Missing: rate limiting beyond login, CSRF protection, input sanitization, CORS config.

**Cron route state (accurate):** `src/app/api/cron/deadline-check/route.ts` already checks `x-cron-secret` header against `CRON_SECRET` env var, BUT has a hardcoded fallback `'ibs-cron-2026'`. Meanwhile `src/middleware.ts` bypasses all auth for `/api/cron` routes. Fix: remove hardcoded fallback AND tighten middleware bypass.

**`dangerouslySetInnerHTML` in layout.tsx:** This is a `crypto.randomUUID` polyfill added in commit `9bf1748` to fix Next.js client router crash on insecure HTTP. Do NOT simply remove it — replace with a `<Script>` tag loading from `/public/polyfills.js` to maintain the same functionality safely.

**`$queryRawUnsafe` in health check:** Static query `SELECT 1` — low risk but replace with `$queryRaw` for best practice.

### Tasks

1. **CRON_SECRET hardening:**
   - Remove hardcoded fallback `'ibs-cron-2026'` from `deadline-check/route.ts`
   - Update `src/middleware.ts`: cron routes must include `x-cron-secret` header matching `CRON_SECRET` env var (instead of bypassing auth entirely)
   - Add `CRON_SECRET` to `.env.example` with a placeholder value
   - Test: cron without secret → 401

2. **Rate limiting:**
   - Install `rate-limiter-flexible` or implement simple in-memory rate limiter
   - Create `src/lib/rate-limiter.ts`:
     - Login: 5 attempts / minute / IP (verify existing implementation in login route)
     - API general: 100 requests / minute / user
     - Upload: 10 requests / minute / user
   - Apply in middleware or per-route

3. **Input sanitization (standalone — no dependency on Step 6):**
   - Install `isomorphic-dompurify` or `sanitize-html`
   - Create `src/lib/sanitize.ts` — sanitize all string inputs in POST/PUT
   - Create standalone middleware or utility (do NOT reference `validateBody()` from Step 6 — it may not exist yet)

4. **CORS configuration:**
   - Add CORS headers in `next.config.ts` or middleware
   - Allow only production domain + localhost in dev

5. **Fix known issues:**
   - Move `crypto.randomUUID` polyfill from `dangerouslySetInnerHTML` to `/public/polyfills.js` loaded via Next.js `<Script strategy="beforeInteractive">`. Verify the polyfill still runs before Next.js router initializes.
   - Replace `$queryRawUnsafe('SELECT 1')` with `$queryRaw\`SELECT 1\`` in health check

6. **Security headers audit:**
   - Verify CSP is properly configured
   - Add `Permissions-Policy` header
   - Add `Referrer-Policy: strict-origin-when-cross-origin`

7. Add tests for rate limiter and sanitization

### Verification

```bash
npm test
npm run build
# Manual: hit login 6 times rapidly → expect 429
# Manual: send <script> in body → expect sanitized
# Manual: hit /api/cron/check without secret → expect 401
```

### Exit Criteria

- Cron routes protected with secret
- Rate limiting active on all routes
- Input sanitization on all POST/PUT
- CORS configured
- Known issues fixed
- Tests passing
- PR merged to main

### Rollback

```bash
git revert <commit-sha>
```

---

## Step 8: Redis Caching Layer

- **Branch:** `feat/redis-caching`
- **Depends on:** Step 1
- **Model tier:** default
- **Parallel group:** B (steps 2-5, 6a, 7, 8)

### Context Brief

No caching layer exists. All API routes query Prisma directly. Hot paths: dashboard stats, task inbox, project overview, module stats, RBAC role lookups. PostgreSQL handles all reads. Goal: add Redis as opt-in cache for read-heavy endpoints with TTL-based invalidation.

### Tasks

1. Install dependencies:
   ```bash
   npm install ioredis
   ```
2. Create `src/lib/cache.ts`:
   - Redis client singleton (connect via `REDIS_URL` env var)
   - Graceful fallback when Redis unavailable (skip cache, query DB)
   - Helper functions:
     - `cacheGet<T>(key)` → T | null
     - `cacheSet(key, value, ttlSeconds)`
     - `cacheInvalidate(pattern)` — delete by key pattern
     - `withCache<T>(key, ttl, fetcher)` — cache-aside pattern
3. Add cache to hot endpoints:
   - `GET /api/dashboard` — TTL 60s, invalidate on task completion
   - `GET /api/dashboard/role` — TTL 60s per role
   - `GET /api/tasks` (inbox) — TTL 30s, invalidate on task change
   - `GET /api/admin/stats` — TTL 120s
   - `GET /api/warehouse/stats` — TTL 60s
   - `GET /api/projects` (list) — TTL 60s
4. Add cache invalidation in write operations:
   - Task complete/reject → invalidate dashboard + task caches
   - Project create/update → invalidate project list
   - Stock movement → invalidate warehouse stats
5. Add `REDIS_URL` to `.env.example`
6. Update `docker-compose.prod.yml` — add Redis service
7. Unit tests for cache helpers (mock ioredis)

### Verification

```bash
npm test -- src/lib/__tests__/cache.test.ts
npm run build
docker compose -f docker-compose.prod.yml config  # validate compose
```

### Exit Criteria

- Cache-aside pattern working for 6+ hot endpoints
- Graceful fallback when Redis unavailable
- Cache invalidation on writes
- Docker compose includes Redis
- Tests passing
- PR merged to main

### Rollback

```bash
git revert <commit-sha>
# Redis is opt-in — removing it just means DB-only reads
```

---

## Step 9: OpenAPI / Swagger Documentation

- **Branch:** `feat/openapi-docs`
- **Depends on:** Step 6c (all routes migrated), Step 7 (rate limit headers to document)
- **Model tier:** default
- **Parallel group:** —

### Context Brief

No API documentation exists. 82 API routes now have Zod schemas (from Steps 6a-6c). Rate limiting and CORS are configured (from Step 7). Goal: auto-generate OpenAPI 3.1 spec from Zod schemas, serve Swagger UI at `/api/docs`. Document rate limit 429 responses and CORS behavior.

### Tasks

1. Install dependencies:
   ```bash
   npm install zod-openapi
   ```
   For Swagger UI, use `swagger-ui-dist` (static assets) instead of `swagger-ui-react` to avoid SSR/hydration issues with Next.js 16 App Router.
2. Create `src/lib/openapi.ts`:
   - Register all Zod schemas with OpenAPI metadata (descriptions, examples)
   - Define API paths grouped by tag (auth, projects, tasks, design, warehouse, production, qc, hr, finance)
   - Generate OpenAPI 3.1 JSON spec
   - Include 429 (rate limit) response schema on all routes
3. Create `src/app/api/docs/route.ts` — serve OpenAPI JSON
4. Create `src/app/dashboard/api-docs/page.tsx` — Swagger UI page using `'use client'` directive and dynamic import of swagger-ui-dist
5. Add security scheme (Bearer JWT) to spec
6. Add response schemas (success/error patterns)
7. Add example request/response for each endpoint

### Verification

```bash
npm run build
# Manual: visit /api/docs/ui → Swagger UI renders
# Manual: GET /api/docs → valid OpenAPI JSON
```

### Exit Criteria

- OpenAPI 3.1 spec covers all 82 routes
- Swagger UI accessible at `/api/docs/ui`
- Spec validates with OpenAPI linter
- PR merged to main

### Rollback

```bash
git revert <commit-sha>
```

---

## Step 10: Integration Tests (API Routes)

- **Branch:** `test/api-integration`
- **Depends on:** Steps 6c, 7, 8
- **Model tier:** strongest (Opus) — complex API interactions
- **Parallel group:** —

### Context Brief

Unit tests cover business engines (Steps 2-5). Now test API routes end-to-end with real HTTP requests against a test database. Verify auth, validation, RBAC, and data flow.

### Tasks

1. Create `src/app/api/__tests__/setup.ts`:
   - **Test database provisioning:**
     - Add `DATABASE_URL_TEST` to `.env.example`
     - Create `scripts/setup-test-db.sh`: creates a `ibs_erp_test` PostgreSQL database, runs `npx prisma migrate deploy` against it
     - Add `"test:setup-db": "bash scripts/setup-test-db.sh"` to package.json
   - Seed test data (users with different roles R01/R06/R09, a project, materials)
   - Helper: `authenticatedFetch(route, options, role)` — auto-inject JWT for role
   - Vitest `beforeAll`/`afterAll` hooks: run migrations, seed, cleanup
2. Test auth routes:
   - Login success/failure
   - Token expiration
   - Protected route without token → 401
3. Test RBAC:
   - R06 (Production) cannot access finance routes
   - R01 (Director) can access all routes
   - R09 (QC) can only access QC routes
4. Test CRUD flows:
   - Create project → get project → update → verify
   - Create PR → approve → convert to PO → approve PO
   - Create material → stock movement IN → verify qty
5. Test validation (Zod):
   - POST with missing required fields → 400
   - POST with invalid types → 400 with Zod errors
6. Test rate limiting:
   - Exceed login rate limit → 429

### Verification

```bash
npm test -- src/app/api/__tests__/
```

### Exit Criteria

- 30+ integration tests covering critical flows
- All RBAC boundaries tested
- Validation errors tested
- PR merged to main

### Rollback

```bash
git revert <commit-sha>
```

---

## Step 11: E2E Test Expansion

- **Branch:** `test/e2e-expansion`
- **Depends on:** Step 10
- **Model tier:** default
- **Parallel group:** —

### Context Brief

Playwright is configured and one E2E file already exists: `e2e/workflow.spec.ts` (tests role-based login and workflow steps with hardcoded test credentials). Goal: expand E2E coverage for critical user journeys, fix/update the existing test, and configure proper DB seeding via globalSetup.

### Tasks

1. Create `e2e/fixtures/auth.ts` — login helper, role-based session setup
2. Create E2E tests:
   - `e2e/auth.spec.ts` — login flow, invalid credentials, session persistence
   - `e2e/dashboard.spec.ts` — dashboard loads, stats display, role-based menu
   - `e2e/project-workflow.spec.ts` — create project → tasks appear → complete P1.1
   - `e2e/procurement.spec.ts` — create PR → approve → create PO
   - `e2e/hr-salary.spec.ts` — view employees → calculate salary → verify result
3. Configure test database seeding in `playwright.config.ts` globalSetup
4. Add visual regression snapshots for dashboard

### Verification

```bash
npx playwright test
npx playwright show-report
```

### Exit Criteria

- 5+ E2E test suites covering critical journeys
- All tests pass in headless mode
- Report generates successfully
- PR merged to main

### Rollback

```bash
git revert <commit-sha>
```

---

## Step 12: CI/CD Pipeline + Final Verification

- **Branch:** `feat/ci-cd-pipeline`
- **Depends on:** Steps 9, 10, 11
- **Model tier:** default
- **Parallel group:** —

### Context Brief

No CI/CD pipeline exists in `.github/workflows/`. Goal: GitHub Actions workflow that runs lint, type check, unit tests, build, and optionally E2E tests on every PR.

### Tasks

1. Create `.github/workflows/ci.yml`:
   ```yaml
   on: [push, pull_request]
   jobs:
     lint-and-typecheck:
       - npm run lint
       - npx tsc --noEmit
     unit-tests:
       - npm test -- --coverage
       - Upload coverage report
     build:
       - npm run build
     e2e-tests: (on main branch only)
       - Setup PostgreSQL service
       - npx prisma migrate deploy
       - npx playwright install
       - npx playwright test
   ```
2. Create `.github/workflows/security.yml`:
   - `npm audit --production` — check for vulnerable dependencies
   - Run on schedule (weekly) and on PR
3. Add status badges to README (if exists)
4. Final comprehensive verification:
   - Run full test suite
   - Run build
   - Run security audit
   - Verify all 12 PRs merged cleanly

### Verification

```bash
npm run lint
npx tsc --noEmit
npm test -- --coverage
npm run build
npx playwright test
npm audit --production
```

### Exit Criteria

- CI pipeline runs on every PR
- All checks pass on main branch
- Security audit has no critical vulnerabilities
- PR merged to main — project improvement complete

### Rollback

```bash
git revert <commit-sha>
```

---

## New Environment Variables Checklist

All new env vars introduced across steps — add to `.env.example` in the step that introduces them:

| Variable | Step | Required | Purpose |
|----------|------|----------|---------|
| `CRON_SECRET` | 7 | Yes (production) | Authenticate cron API calls |
| `REDIS_URL` | 8 | No (graceful fallback) | Redis connection for caching |
| `DATABASE_URL_TEST` | 10 | No (test only) | Test database for integration tests |

---

## Execution Summary

| Step | Name | Depends | Parallel | Model | Est. Size |
|------|------|---------|----------|-------|-----------|
| 1 | Testing infrastructure | — | — | default | S |
| 2 | Unit: workflow-engine | 1 | A | strongest | L |
| 3 | Unit: salary-engine | 1 | A | strongest | L |
| 4 | Unit: sync-engine | 1 | A | default | M |
| 5 | Unit: task-engine | 1 | A | default | M |
| 6a | Zod schemas + helpers | 1 | B | strongest | M |
| 6b | Zod: core routes | 6a | — | default | M |
| 6c | Zod: domain routes | 6b | — | strongest | L |
| 7 | Security hardening | 1 | B | default | L |
| 8 | Redis caching | 1 | B | default | M |
| 9 | OpenAPI docs | 6c, 7 | — | default | M |
| 10 | Integration tests | 6c, 7, 8 | — | strongest | L |
| 11 | E2E expansion | 10 | — | default | M |
| 12 | CI/CD pipeline | 9, 10, 11 | — | default | S |

**Critical path:** 1 → 6a → 6b → 6c → 10 → 11 → 12
**Max parallelism:** 7 concurrent after Step 1 (steps 2, 3, 4, 5, 6a, 7, 8)

---

## Plan Mutation Protocol

To modify this plan after execution begins:

- **Split step:** Create step N.1, N.2 with same dependencies. Update downstream refs.
- **Insert step:** Add between existing steps. Renumber downstream.
- **Skip step:** Mark `[SKIPPED]` with reason. Verify no downstream breaks.
- **Reorder:** Only if dependency graph allows. Verify with `depends on` field.
- **Abandon:** Mark `[ABANDONED]` with reason. Document partial state.

All mutations must be logged in this file with timestamp and reason.

---

## Merge Strategy for Parallel Steps

**Group A (steps 2-5):** Each step creates test files in `src/lib/__tests__/`. Since they create separate files (no shared state), merge conflicts should be minimal. Merge in order 2→3→4→5. If conflicts arise in `package.json` or shared test utilities, the later branch should rebase onto main after prior merges.

**Group B (steps 6a, 7, 8):** These touch different areas (schemas, middleware, cache). Merge 6a first (schemas needed by 6b), then 7 and 8 in any order.

---

## Review Log

- **2026-04-02:** Adversarial review by Opus sub-agent identified 6 CRITICAL, 8 WARNING, 6 INFO findings. All 6 criticals fixed:
  - C1: Dependencies corrected — steps 6a/7/8 depend on Step 1, not Steps 2-5
  - C2: Step 7 made fully standalone — no reference to Step 6's validateBody()
  - C3: Step 6 split into 6a (schemas), 6b (core routes), 6c (domain routes)
  - C4: E2E invariant removed until Step 11; added lint invariant
  - C5: Route count corrected to 82
  - C6: Cron route context updated with accurate current state (existing x-cron-secret check + hardcoded fallback)
