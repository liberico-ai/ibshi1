# IBS ERP — Development Guidelines

## Pre-flight Checks (MUST DO before every code change)

### 1. Understand Blast Radius
Before modifying any file, check what depends on it:
- **Workflow step change?** → Check `workflow-constants.ts` gates/rejectTo + `step-form-configs.ts` + `tasks/[id]/page.tsx` rendering
- **API route change?** → Check which pages call it (grep for the endpoint URL)
- **Prisma model change?** → Run `npx prisma generate` after, check all routes importing that model
- **Task detail page change?** → This is ~5420 lines. Only modify the section for the specific stepCode. Search for `task.stepCode === 'Pxx'` to find boundaries

### 2. Critical Files — Change with Extra Caution
| File | Lines | Risk | What breaks |
|------|-------|------|-------------|
| `src/app/dashboard/tasks/[id]/page.tsx` | ~5420 | HIGH | All 36 workflow step UIs |
| `src/lib/workflow-engine.ts` | ~1042 | HIGH | Task completion, rejection, activation |
| `src/lib/work-engine.ts` | ~891 | HIGH | createTask, resolveAssignees |
| `src/lib/workflow-constants.ts` | ~216 | HIGH | Step ordering, gates, role assignments |
| `src/lib/step-form-configs.ts` | ~729 | MEDIUM | Form fields, checklists, validation |
| `src/lib/sync-engine.ts` | ~159 | HIGH | Budget sync, stock movements, change events |
| `src/lib/auth.ts` | ~156 | HIGH | Auth, RBAC, all API responses |
| `src/app/api/tasks/[id]/route.ts` | ~949 | HIGH | Task API, previousStepData for all steps |
| `src/app/dashboard/tasks/[id]/components/BomPrUploadUI.tsx` | ~1227 | HIGH | BOM/PR upload, stock matching, enrichment |
| `src/components/SupplierQuoteUI.tsx` | ~913 | MEDIUM | Supplier quotes, matrix, PO creation |
| `src/lib/constants.ts` | ~264 | HIGH | ROLES, FORM_EDIT_ROLES, KEY_TO_FORM, canEditForm |
| `src/lib/types/cross-step-data.ts` | ~320 | HIGH | Single source of truth for ALL cross-step types |
| `src/lib/data-fetchers.ts` | ~249 | HIGH | Shared data fetch helpers (BOM, estimate, supplier) |
| `src/lib/schemas/cross-step.schema.ts` | ~195 | MEDIUM | Zod runtime validation for cross-step data |
| `src/lib/save-attachment.ts` | ~94 | MEDIUM | Shared file upload helper (allowlists, disk write, DB) |
| `src/lib/org-map.ts` | ~58 | HIGH | ROLE_TO_DEPT, DEPT_PRIMARY_ROLE — dept assignment for all users |
| `src/lib/telegram.ts` | ~191 | MEDIUM | Telegram bot singleton, sendGroupMessage |
| `src/lib/telegram-notifications.ts` | ~182 | LOW | Notification formatters (activated, rejected, overdue) |
| `src/lib/telegram-commands.ts` | ~529 | LOW | 12 bot commands (/mytasks, /status, etc.) |

### 3. Post-change Verification
After every change, run in order:
```bash
npx eslint src 2>&1 | grep "rules-of-hooks" && echo "FAIL" || echo "OK"  # Must print OK (no hook violations)
npx tsc --noEmit 2>&1 | grep -v "__tests__" | grep "error TS"            # Must be empty
npm run build                                                              # Must succeed
npx vitest run --reporter=verbose 2>&1 | tail -20                          # Check pass/fail
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
R01=BGĐ, R02=PM, R02a=NV QLDA, R03=KTKH, R03a=NV KTKH, R04=Design, R04a=NV TK, R05=Warehouse, R05a=NV Kho, R06=Production, R06a=NV SX, R06b=Tổ trưởng SX, R07=Commercial, R07a=NV TM, R08=Finance, R08a=NV KT, R09=QC, R09a=Kiểm tra viên, R10=Admin, R11=NV HCNS (inactive), R12=NV EPC (0 user), R13=TP TBCG

### Cơ cấu phòng ban (sau quy hoạch 2026-06, gộp KTKT 2026-07)
9 phòng chuẩn, nguồn gốc: `ROLE_TO_DEPT` trong `src/lib/org-map.ts`.

| Phòng | Code | Role trưởng | Role khác | Ghi chú |
|-------|------|-------------|-----------|---------|
| Ban Giám đốc | BGD | R01 | | |
| CNTT & Dữ liệu | CNTT | R10 | | |
| Phòng Kỹ thuật | TK | R04 | R04a | |
| Kinh tế Kỹ thuật | KTKT | R03 | R03a, R07, R07a | Gộp KTKH + TM (2026-07). Giữ 4 roleCode — RBAC keyed by roleCode |
| Quản lý Dự án | QLDA | R02 | R02a | |
| Sản xuất | SX | R06 | R06a, R06b | Tổ TO-\* là dept con qua `Department.parentId` |
| Tài chính KT & Kho | TCKT | R08 | R08a, R05, R05a | Gộp Kho + Kế toán |
| QA/QC | QC | R09 | R09a | |
| Thiết bị & Cơ giới | TBCG | R13 | | Mới tạo 2026-06 |

- Role cấp phó đã đổi tên "Phó X" → "Nhân viên X" (roleCode GIỮ NGUYÊN — RBAC keyed by roleCode).
- R06b = Công nhân sản xuất (77 user, ở trong tổ TO-\*). R09a = Kiểm tra viên (giữ nguyên tên).
- R11 = Nhân viên HCNS — phòng HCNS đã bỏ, 13 user inactive (dept=null). R12 = NV EPC (0 user, skip).
- Công nhân tổ giữ `User.departmentId` = tổ (TO-HAN1, TO-PC2, …); tổ có `Department.parentId` = SX dept id.
- Thêm phòng/role mới: khai vào `org-map.ts` (ROLE_TO_DEPT, DEPT_PRIMARY_ROLE, DEPARTMENTS_V2) + `constants.ts` (ROLES, ROLE_GROUP_PRIORITY, menu roles).

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

### Telegram Bot Setup
1. Create bot via @BotFather → get `TELEGRAM_BOT_TOKEN`
2. Generate random `TELEGRAM_WEBHOOK_SECRET`
3. Add bot to company group → get chat ID → set `TELEGRAM_GROUP_CHAT_ID`
4. Set `NEXT_PUBLIC_APP_URL` (e.g., `https://erp.ibs.vn`)
5. Call `POST /api/telegram/setup` with R01/R10 admin token to register webhook
6. Bot is live — tasks auto-notify to group, commands respond to users

### Modifying workflow transitions
1. Edit `workflow-constants.ts` — update `next`, `gate`, `rejectTo`
2. If adding sync hooks, implement in `sync-engine.ts`
3. Test the full flow: complete → next step activates → rejection returns correctly

### Form-level permissions (RBAC per biểu mẫu)
Two parallel systems enforce which roles can edit each form:
- **Server**: `FORM_EDIT_ROLES` + `KEY_TO_FORM` + `canEditForm()` in `src/lib/constants.ts` — guards `POST /api/work/tasks/[id]/result-data`
- **Frontend**: `canEditForm()` in `src/components/TemplateSelector.tsx` — hides/disables edit UI

When adding a new form template:
1. Add it to `FORM_EDIT_ROLES` in `constants.ts` with the allowed role codes
2. Add its result-data keys to `KEY_TO_FORM` so the server can map key → form
3. The FE `TemplateSelector` reads the same `FORM_EDIT_ROLES` — no extra step needed

### Supplier quote → PO flow
- `BomPrUploadUI.tsx`: enriches PR items with `neededQty`/`availableQty`/`needToBuyQty` from stock matching
- `SupplierQuoteUI.tsx`: shows breakdown table, MaterialMatrix compares by `needToBuyQty`, "Tạo PO" button
- `POST /api/work/tasks/[id]/create-po`: creates PO with snapshot fields (`itemCode`, `description`, `profile`, `grade`, `unit`), `materialId = null`, `quantity = needToBuyQty`. Idempotent via `resultData.poId`
- PO items with `materialId = null` are supported in GRN page, sync-engine, validation-rules (optional chaining)

### External API (`/api/external/v1`)
- Auth: `ApiClient` table, `Authorization: Bearer <key>`, scoped (`read:tasks`, `write:tasks`, etc.)
- `GET /projects` — list projects; `GET /assignees` — list users/roles; `GET /tasks/{id}` — task detail
- `GET /tasks?updatedSince=<ISO>` — polling for updated tasks
- `POST /tasks` — create task from external system (idempotent via `externalRef`)
  - Supports `attachments[]` (base64) → saved as `TaskDocRequirement` kind=MUST_READ
  - File limits: max 10 files, each ≤20MB, total ≤50MB; only allowed extensions (see `save-attachment.ts`)
- Docs: `docs/API_TICH_HOP_SALE.md`

### File upload helper
- `src/lib/save-attachment.ts`: shared `saveAttachmentFromBuffer()` — used by `/api/upload` and external API
- `ALLOWED_EXTENSIONS`: pdf/doc/xls/png/jpg/dwg/zip/etc. — blocks svg/html/exe
- `validateFileName()`: checks extension against allowlist, returns error string or null
- `ENTITY_ID_REGEX`: `^[A-Za-z0-9._-]+$` — prevents path traversal in entityId

### API response convention
All API routes MUST use `successResponse()`/`errorResponse()` from `@/lib/auth` — NOT raw `NextResponse.json`.
ESLint warns on `NextResponse.json` in `src/app/api/**` (rule: `no-restricted-syntax`).
Exceptions: `/api/docs`, `/api/telegram/webhook`.

### Overdue / date / currency formatting
- Use `isTaskOverdue()` / `taskDaysOverdue()` from `src/lib/utils.ts` — centralized, uses `startOfDay`
- Use `formatDate()` / `formatCurrency()` / `formatNumber()` from same file
- Do NOT inline `new Date()` comparisons — always go through these helpers
