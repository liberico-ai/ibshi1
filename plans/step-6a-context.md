# Step 6a Context: Zod Schemas + Validation Helpers

> **Status:** COMPLETED
> **Date:** 2026-04-02
> **Tests:** 185 (no new tests — schemas are tested via route integration in Step 6b/6c)

---

## Summary

Created comprehensive Zod v4 validation schemas for all API domains and three validation helper functions for use in route handlers.

---

## Files Added

### `src/lib/schemas/` — 13 schema files + index

| File | Schemas | Domain |
|------|---------|--------|
| `common.schema.ts` | paginationSchema, idParamSchema, dateRangeSchema, sortOrderSchema, searchFilterSchema | Shared patterns |
| `auth.schema.ts` | loginSchema | Auth |
| `user.schema.ts` | createUserSchema, updateUserSchema | User management |
| `project.schema.ts` | projectListQuerySchema, createProjectSchema, updateProjectSchema | Projects |
| `task.schema.ts` | rejectTaskSchema, taskCommentSchema, completeTaskSchema, activateTasksSchema | Tasks |
| `material.schema.ts` | createMaterialSchema, updateMaterialSchema, stockMovementSchema | Materials |
| `procurement.schema.ts` | createPurchaseRequestSchema, createPurchaseOrderSchema, convertPrToPoSchema, createGrnSchema, createVendorSchema, updateVendorSchema | Procurement |
| `production.schema.ts` | createWorkOrderSchema, updateWorkOrderSchema, createJobCardSchema, updateJobCardSchema, createMaterialIssueSchema, createWorkshopSchema, createDeliverySchema, updateDeliverySchema | Production |
| `qc.schema.ts` | inspectionListQuerySchema, createInspectionSchema, updateInspectionSchema, createItpSchema, createNcrSchema, updateNcrSchema, createNcrActionSchema, createCertificateSchema, createMillCertSchema | QC |
| `design.schema.ts` | createDrawingSchema, updateDrawingSchema, createDrawingRevisionSchema, drawingTransitionSchema, createBomSchema, updateBomSchema, createEcoSchema, updateEcoSchema | Design |
| `hr.schema.ts` | employeeListQuerySchema, createEmployeeSchema, updateEmployeeSchema, recordAttendanceSchema, bulkAttendanceSchema, salaryCalcSchema, createContractSchema, updateContractSchema, createPieceRateContractSchema, createPieceRateOutputSchema, createTimesheetSchema | HR |
| `finance.schema.ts` | createInvoiceSchema, updateInvoiceSchema, createPaymentSchema, createBudgetSchema, updateBudgetSchema, createCashflowSchema, updateCashflowSchema | Finance |
| `index.ts` | Re-exports all schemas and types | Barrel |

### `src/lib/api-helpers.ts` — Validation helpers

Three helpers returning discriminated union `{ success: true, data: T } | { success: false, response: NextResponse }`:

- **`validateBody(request, schema)`** — Parse JSON body with Zod schema. Returns 400 with field-level errors on failure.
- **`validateQuery(url, schema)`** — Parse URL search params. Handles string-to-number coercion for pagination.
- **`validateParams(params, schema)`** — Parse route params (e.g., `{ id: string }`).

All use `formatZodErrors()` for human-readable error messages: `"field: message; field2: message2"`.

---

## Usage Pattern (for Step 6b/6c)

```typescript
import { validateBody, validateQuery, validateParams } from '@/lib/api-helpers'
import { createProjectSchema, projectListQuerySchema, idParamSchema } from '@/lib/schemas'

// Body validation
const result = await validateBody(req, createProjectSchema)
if (!result.success) return result.response
const { projectCode, projectName } = result.data

// Query validation
const qResult = validateQuery(req.url, projectListQuerySchema)
if (!qResult.success) return qResult.response
const { page, limit, search, status } = qResult.data

// Params validation
const pResult = validateParams(await params, idParamSchema)
if (!pResult.success) return pResult.response
const { id } = pResult.data
```

---

## Zod v4 Notes

- **`z.record()` requires 2 args**: Use `z.record(z.string(), z.unknown())`, NOT `z.record(z.unknown())`.
- **`z.coerce.number()`**: Used for pagination params (strings from URL converted to numbers).
- **Error messages in Vietnamese**: Business-facing validation messages use Vietnamese.

---

## Impact on Other Steps

- **Step 6b/6c**: Use these schemas in API route handlers via `validateBody`/`validateQuery`/`validateParams`.
- **Step 7 (Security)**: `sanitizeString` from `@/lib/sanitize` can be composed as `.transform(sanitizeString)` in schemas if needed.
- **Step 8 (Cache)**: Cache key generation should use validated params (after Zod parse).
- **Step 9 (OpenAPI)**: Zod schemas can be converted to OpenAPI JSON Schema using `zod-to-openapi` or manual extraction.
