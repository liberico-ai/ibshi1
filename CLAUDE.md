# IBS ERP — Development Guidelines

## Pre-flight Checks (MUST DO before every code change)

### 1. Understand Blast Radius
Before modifying any file, check what depends on it:
- **Workflow step change?** → Check `workflow-constants.ts` gates/rejectTo + `step-form-configs.ts` + `tasks/[id]/page.tsx` rendering
- **API route change?** → Check which pages call it (grep for the endpoint URL)
- **Prisma model change?** → Run `npx prisma generate` after, check all routes importing that model
- **Task detail page change?** → This is 5900+ lines. Only modify the section for the specific stepCode. Search for `task.stepCode === 'Pxx'` to find boundaries

### 2. Critical Files — Change with Extra Caution
| File | Lines | Risk | What breaks |
|------|-------|------|-------------|
| `src/app/dashboard/tasks/[id]/page.tsx` | 5900+ | HIGH | All 36 workflow step UIs |
| `src/lib/workflow-engine.ts` | 562 | HIGH | Task completion, rejection, activation |
| `src/lib/workflow-constants.ts` | 209 | HIGH | Step ordering, gates, role assignments |
| `src/lib/step-form-configs.ts` | ~400 | MEDIUM | Form fields, checklists, validation |
| `src/lib/sync-engine.ts` | 357 | HIGH | Budget sync, stock movements, change events |
| `src/lib/auth.ts` | 150 | HIGH | Auth, RBAC, all API responses |
| `src/app/api/tasks/[id]/route.ts` | ~484 | HIGH | Task API, previousStepData for all steps |
| `src/lib/types/cross-step-data.ts` | ~280 | HIGH | Single source of truth for ALL cross-step types |
| `src/lib/data-fetchers.ts` | ~230 | HIGH | Shared data fetch helpers (BOM, estimate, supplier) |
| `src/lib/schemas/cross-step.schema.ts` | ~120 | MEDIUM | Zod runtime validation for cross-step data |

### 3. Post-change Verification
After every change, run in order:
```bash
npx tsc --noEmit 2>&1 | grep -v "__tests__" | grep "error TS"  # Must be empty
npm run build                                                      # Must succeed
npx vitest run --reporter=verbose 2>&1 | tail -20                  # Check pass/fail
```

## Architecture Quick Reference

### Workflow Steps (36 total, 6 phases)
- Phase 1: P1.1 → P1.1B → P1.2A + P1.2 (parallel) → P1.3 (gate: both)
- Phase 2: P2.1 + P2.2 + P2.3 + P2.1A (parallel) → P2.4 (gate: all 4) → P2.5
- Phase 3: P3.1 → P3.2 → P3.3 + P3.5 → P3.6 → P3.7 | P3.4 (parallel)
- Phase 4: P4.1 + P4.2 → P4.3 → P4.4 → P4.5
- Phase 5: P5.1 → P5.2 → P5.3 → P5.4 → P5.5
- Phase 6: P6.1 + P6.2 + P6.3 + P6.4 (parallel) → P6.5 (gate: all 4)

### Role Codes
R01=BGĐ, R02=PM, R03=KTKH, R04=Design, R05=Warehouse, R06=Production, R07=Commercial, R08=Finance, R09=QC, R10=Admin

### API Response Pattern
```typescript
successResponse({ data })     // { ok: true, ...data }
errorResponse('message', 400) // { ok: false, error: 'message' }
```

### State Management
- Server: Prisma + PostgreSQL + Redis cache
- Client: Zustand (useAuthStore) + React useState
- Files: FileAttachment table, entityId = `{taskId}_{attachmentKey}`

## Common Patterns

### Adding a new field to a workflow step
1. Add field to `step-form-configs.ts` in the step's config
2. The generic form renderer at the bottom of `tasks/[id]/page.tsx` handles it automatically
3. No need to modify page.tsx unless custom UI is required

### Adding custom UI for a step
1. Find the step's section in `tasks/[id]/page.tsx` (search `task.stepCode === 'Pxx'`)
2. Add rendering between the step description card and the generic form section
3. Store data via `handleFieldChange(key, value)` — it auto-saves to formData

### Changing a shared data structure (BOM, estimate, supplier, WBS, etc.)
1. Update the type in `src/lib/types/cross-step-data.ts` (single source of truth)
2. Update matching Zod schema in `src/lib/schemas/cross-step.schema.ts`
3. Run `npx tsc --noEmit` — compiler will show ALL files that need updating
4. Fix each consumer, then run `npx vitest run` to verify data flow tests pass

### Adding a new previousStepData consumer
1. Add the PrevData interface to `src/lib/types/cross-step-data.ts`
2. Add entry to `PreviousStepDataMap`
3. Use data fetcher helpers from `src/lib/data-fetchers.ts` (never duplicate fetch logic)
4. Add integration test in `src/lib/__tests__/cross-step-flow.test.ts`

### Modifying workflow transitions
1. Edit `workflow-constants.ts` — update `next`, `gate`, `rejectTo`
2. If adding sync hooks, implement in `sync-engine.ts`
3. Test the full flow: complete → next step activates → rejection returns correctly
