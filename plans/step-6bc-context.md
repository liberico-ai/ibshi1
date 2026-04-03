# Steps 6b/6c Context: Zod Migration of API Routes

> **Status:** COMPLETED
> **Date:** 2026-04-02
> **Tests:** 185 (all passing, no regressions)
> **Routes modified:** 54 out of 82

---

## Summary

Migrated 54 API route files to use Zod validation via `validateBody()`, `validateQuery()`, and `validateParams()` from `@/lib/api-helpers`. The remaining ~28 routes are simple read endpoints (e.g., GET without query params, health check, cron, notifications) that don't need validation.

---

## Pattern Applied

### Write routes (POST/PUT/PATCH)
```typescript
import { validateBody } from '@/lib/api-helpers'
import { createProjectSchema } from '@/lib/schemas'

const result = await validateBody(req, createProjectSchema)
if (!result.success) return result.response
const { field1, field2 } = result.data
```

### Read routes with query params (GET)
```typescript
import { validateQuery } from '@/lib/api-helpers'
import { projectListQuerySchema } from '@/lib/schemas'

const qResult = validateQuery(req.url, projectListQuerySchema)
if (!qResult.success) return qResult.response
const { page, limit, search, status } = qResult.data
```

### Routes with [id] params
```typescript
import { validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'

const pResult = validateParams(await params, idParamSchema)
if (!pResult.success) return pResult.response
const { id } = pResult.data
```

---

## Fixes Applied During Migration

1. **`grn/route.ts`**: Renamed `result` to `validation` to avoid shadowing the `$transaction` result variable.
2. **`stock-movements/route.ts`**: Same rename to avoid variable shadowing.
3. **`projects/route.ts`**: `contractValue` is `string | number` from schema — wrapped with `parseFloat(String(...))`.
4. **`finance/budgets/route.ts`**: `month`/`year` optional in schema but required in Prisma compound key — defaulted to `0`.
5. **`delivery/route.ts`**: `packingList` is `z.unknown().optional()` → cast to `object` for Prisma JSON field compatibility.

---

## Routes NOT Modified (no validation needed)

- `health/route.ts` — simple health check (already modified in Step 7)
- `cron/check/route.ts`, `cron/deadline-check/route.ts` — internal cron endpoints
- `auth/me/route.ts` — no body/query params
- `notifications/route.ts` — simple GET
- `reports/*` — read-only aggregation routes
- `materials/seed/route.ts` — internal seeding
- `upload/route.ts`, `upload/[id]/route.ts` — file upload (FormData, not JSON)
- Various other GET-only routes without query params

---

## Impact on Other Steps

- **Step 9 (OpenAPI)**: All schemas in `src/lib/schemas/` can be used to auto-generate OpenAPI specs.
- **Step 10 (Integration tests)**: Validation errors now return structured 400 responses with field-level error messages.
- **Step 8 (Cache)**: Cache wrapping (`withCache`) is inside validated route handlers — compatible.
