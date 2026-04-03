# Blueprint: Regression Prevention System

> **Objective:** Eliminate cross-step regression bugs by centralizing type definitions, consolidating duplicate data fetchers, and adding integration tests. After this, changing a data structure in one step will cause TypeScript compiler errors in all dependent steps — no more silent runtime failures.
>
> **Generated:** 2026-04-03
> **Repository:** liberico-ai/ibshi1
> **Base branch:** main
> **Steps:** 7 (2 parallel groups)
> **Estimated PRs:** 7

---

## Problem Statement

The IBS ERP has 36 workflow steps where steps produce data consumed by downstream steps. Currently:
- **BomEntry** is defined 4 times in route.ts with inconsistent signatures (line 498 missing `code`, `spec`)
- **TeamAssign, MaterialReqItem** duplicated between page.tsx and WbsTableUI.tsx with different field optionality
- **previousStepData** typed as `{ plan?: any; estimate?: any; ... }` — 18 fields all `any`
- **formData** typed as `Record<string, string | number>` — 150+ keys with zero type safety
- **BOM aggregation** copy-pasted 4 times in route.ts (lines 134-149, 339-352, 377-390, 500-504)
- **Estimate fetch** duplicated 6 times across route.ts
- **Supplier data fetch** duplicated 3 times

**Result:** Changing a field name in one step silently breaks 5-7 downstream steps at runtime.

---

## Dependency Graph

```
[1] Centralized Type Definitions
 │
 ├──[2] Zod Cross-Step Schemas      ──┐
 ├──[3] Data Fetcher Helpers          ├─ PARALLEL GROUP A (3 concurrent)
 ├──[4] Migrate page.tsx + WbsTableUI ┘
 │
 [5] Migrate route.ts  (depends on 1 + 3)
 │
 [6] Integration Tests  (depends on 4 + 5)
 │
 [7] Fix Tests + Full Verification  (depends on 6)
```

> **Critical path:** 1 → 3 → 5 → 6 → 7
> **Max parallelism:** 3 concurrent (steps 2, 3, 4 after step 1)

---

## Invariants (verified after every step)

1. `npx tsc --noEmit 2>&1 | grep -v "__tests__" | grep "error TS"` → empty
2. `npm run build` passes
3. `npx vitest run` → no new failures (9 pre-existing failures in projects.test.ts allowed)
4. No secrets committed

---

## Step 1: Centralized Type Definitions

- **Branch:** `refactor/centralized-types`
- **Depends on:** none
- **Model tier:** default
- **Parallel group:** —
- **Files created:** `src/lib/types/cross-step-data.ts`, `src/lib/types/index.ts`
- **Files modified:** none (additive only — zero regression risk)

### Context Brief

There is no `src/lib/types/` directory. All shared data structures are defined inline: BomEntry 4x in `route.ts`, TeamAssign/MaterialReqItem duplicated between `page.tsx` (line 44-49) and `WbsTableUI.tsx` (line 6-25), previousStepData uses 18 `any` fields. This step creates a single source of truth for ALL cross-step data types. No existing files are modified — only new files created.

### Tasks

1. Create `src/lib/types/cross-step-data.ts` with these type definitions:

   **BOM types:**
   ```typescript
   export interface BomEntry {
     name: string
     code: string
     spec: string
     quantity: string
     unit: string
   }
   export interface BomEntryWithSource extends BomEntry {
     source: 'P2.1' | 'P2.2' | 'P2.3'
   }
   ```

   **WBS types:**
   ```typescript
   export type WbsRow = Record<string, string>
   // Document base keys as constants (not enforced at type level since columns are dynamic):
   export const WBS_BASE_KEYS = ['stt', 'hangMuc', 'dvt', 'khoiLuong', 'phamVi', 'thauPhu', 'batDau', 'ketThuc', 'trangThai', 'khuVuc', 'ghiChu'] as const
   export const WBS_STAGE_KEYS = ['cutting', 'machining', 'fitup', 'welding', 'tryAssembly', 'dismantle', 'blasting', 'painting', 'galvanize', 'insulation', 'commissioning', 'khungKien', 'packing', 'delivery'] as const
   ```

   **Team/LSX types:**
   ```typescript
   export interface TeamAssign {
     teamName: string
     volume?: string
     startDate: string
     endDate: string
     notes?: string
   }
   export type CellAssignMap = Record<number, Record<string, TeamAssign[]>>
   // NOTE: page.tsx inline uses `boolean`, WbsTableUI.tsx uses `{status, details}`.
   // Canonical choice: `boolean` (matches the actually-used inline WbsTableUI in page.tsx).
   // If WbsTableUI.tsx is later extracted to replace inline version, update this type.
   export type LsxIssuedMap = Record<number, Record<string, Record<number, boolean>>>
   ```

   **Material request types:**
   ```typescript
   export interface MaterialReqItem {
     name: string
     code?: string
     spec: string
     quantity?: string
     qty?: string        // Legacy alias for quantity (used in some WbsTableUI paths)
     unit?: string
     status?: string
     requested?: boolean
   }
   export type MaterialReqMap = Record<number, Record<string, Record<number, MaterialReqItem[]>>>
   ```

   **MOM types:**
   ```typescript
   export interface MomItem {
     stt: string
     noiDung: string
     actionBy: string
     dueDate: string
     remark: string
   }
   export interface MomSection {
     key: string
     title: string
     items: MomItem[]
   }
   export interface MomAttendant {
     name: string
     role: string
   }
   ```

   **Estimate types (DT02-DT07):**
   ```typescript
   export interface Dt02Row {
     maCP: string
     noiDung: string
     giaTri: string
     tyLe: string
   }
   export interface Dt03Row {
     nhomVT: string
     danhMuc: string
     dvt: string
     kl: string
     donGia: string
     thanhTien: string
   }
   export interface DtGenericRow {
     maCP: string
     noiDung?: string
     danhMuc?: string
     dvt: string
     kl: string
     donGia: string
     thanhTien: string
   }
   export interface EstimateTotals {
     totalMaterial: string | number
     totalLabor: string | number
     totalService?: string | number
     totalOverhead?: string | number
     totalEstimate: string | number
     estimateFileName?: string
     dt02Detail?: Array<{ maCP: string; noiDung: string; giaTri: number }>
   }
   ```

   **Supplier/PO types:**
   ```typescript
   export interface SupplierQuote {
     material: string
     price: string
   }
   export interface SupplierEntry {
     name: string
     quotes: SupplierQuote[]
   }
   export interface PoData {
     poNumber?: string
     totalAmount?: string
     paymentType?: 'full' | 'partial'
     paymentMilestones?: Array<{
       label: string
       percent: string
       date: string
     }>
   }
   ```

   **Work Order / Job Card types:**
   ```typescript
   export interface WoItem {
     costCode: string
     content: string
     jobCode: string
     typeCode: string
     unit: string
     qty1: string
     qty2: string
     totalQty: string
     startDate: string
     endDate: string
   }
   export interface JobCardStage {
     hangMuc: string
     volume: string
     unit: string
     team: string
   }
   ```

   **QC types:**
   ```typescript
   export interface QcItem {
     task: string
     result: string
   }
   ```

   **PreviousStepData per-step types (the key regression preventer):**
   ```typescript
   export interface PrevDataP13 {
     plan: { wbsItems?: string; momSections?: string; momAttendants?: string; [k: string]: unknown } | null
     estimate: (EstimateTotals & { dt02Items?: Dt02Row[]; dt03Items?: Dt03Row[] } & Record<string, unknown>) | null
   }
   export interface PrevDataP23 {
     bom: { bomItems?: BomEntry[] } & Record<string, unknown> | null
     estimate: EstimateTotals & Record<string, unknown> | null
   }
   export interface PrevDataP24 {
     bomMain: { bomItems?: BomEntry[] } & Record<string, unknown> | null
     bomWeldPaint: { bomItems?: BomEntry[] } & Record<string, unknown> | null
     bomSupply: { bomItems?: BomEntry[] } & Record<string, unknown> | null
     estimate: EstimateTotals & Record<string, unknown> | null
   }
   export interface PrevDataP25 extends PrevDataP24 {
     plan: Record<string, unknown> | null
   }
   export interface PrevDataP31 {
     plan: { wbsItems?: string; [k: string]: unknown } | null
   }
   export interface PrevDataP32 {
     prItems: BomEntryWithSource[]
     fromStock: Array<BomEntryWithSource & { requestedQty: number; inStock: number; matchedMaterial: unknown }>
     toPurchase: Array<BomEntryWithSource & { requestedQty: number; inStock: number; shortfall: number; specMatch: boolean; matchedMaterial: unknown }>
   }
   export interface PrevDataP33P34 {
     plan: { wbsItems?: string; [k: string]: unknown } | null
     bomItems: BomEntryWithSource[]
   }
   export interface PrevDataP35 {
     prItems: BomEntryWithSource[]
   }
   export interface PrevDataP36 {
     supplierData: { suppliers?: SupplierEntry[] } & Record<string, unknown> | null
     estimate: EstimateTotals & Record<string, unknown> | null
   }
   export interface PrevDataP37 {
     supplierData: { suppliers?: SupplierEntry[] } & Record<string, unknown> | null
   }
   export interface PrevDataP41 {
     poData: PoData & Record<string, unknown> | null
   }
   export interface PrevDataP42 {
     poData: PoData & Record<string, unknown> | null
     supplierData: { suppliers?: SupplierEntry[] } & Record<string, unknown> | null
   }
   export interface PrevDataP43 extends PrevDataP42 {}
   export interface PrevDataP44 {
     qcData: { inspectionResult?: string; qcItems?: QcItem[] } & Record<string, unknown> | null
     supplierData: Record<string, unknown> | null
     prItems: BomEntryWithSource[]
   }
   export interface PrevDataP45 {
     lsxData: Record<string, unknown> | null
     woData: { woItems?: WoItem[] } & Record<string, unknown> | null
     inventory: Array<{ code: string; name: string; spec: string; stock: number; unit: string; category: string }>
   }
   export interface PrevDataP52 {
     jobCardData: Record<string, unknown> | null
   }
   export interface PrevDataP54 {
     jobCardData: Record<string, unknown> | null
     volumeData: Record<string, unknown> | null
   }
   export interface PrevDataP62 {
     budgetTotal: number    // Computed as Number(rd.totalEstimate || 0) in route.ts line 582
   }
   export interface PrevDataP65 {
     p61Status: string
     p62Status: string
     p62Total: unknown
     p62Variance: unknown
     p63Status: string
     p63Profit: unknown
     p63Margin: unknown
     p64Status: string
   }

   /** 
    * Union type for type narrowing.
    * NOTE: `departmentEstimates` exists in page.tsx state but is never sent from route.ts.
    * It's included here for backward compat — can be removed once confirmed unused.
    */
   export type PreviousStepDataMap = {
     'P1.3': PrevDataP13
     'P2.3': PrevDataP23
     'P2.4': PrevDataP24
     'P2.5': PrevDataP25
     'P3.1': PrevDataP31
     'P3.2': PrevDataP32
     'P3.3': PrevDataP33P34
     'P3.4': PrevDataP33P34
     'P3.5': PrevDataP35
     'P3.6': PrevDataP36
     'P3.7': PrevDataP37
     'P4.1': PrevDataP41
     'P4.2': PrevDataP42
     'P4.3': PrevDataP43
     'P4.4': PrevDataP44
     'P4.5': PrevDataP45
     'P5.2': PrevDataP52
     'P5.4': PrevDataP54
     'P6.2': PrevDataP62
     'P6.5': PrevDataP65
   }
   ```

   **Attached files type (shared between route.ts and page.tsx):**
   ```typescript
   // NOTE: route.ts gets `Date` from Prisma, page.tsx receives `string` after JSON serialization.
   // Use `string | Date` to support both sides of the serialization boundary.
   export interface PrevStepFile {
     stepCode: string
     stepName: string
     files: Array<{
       id: string
       fileName: string
       fileUrl: string
       fileSize: number | null
       mimeType: string | null
       createdAt: string | Date
     }>
   }
   ```

2. Create `src/lib/types/index.ts` — barrel export all types from `cross-step-data.ts`

3. Verify: `npx tsc --noEmit` passes (new files only, no consumers yet)

### Verification

```bash
npx tsc --noEmit 2>&1 | grep -v "__tests__" | grep "error TS"
npm run build
```

### Exit Criteria

- All shared types defined in single file
- `PreviousStepDataMap` covers all 20 steps that use previousStepData
- Build passes
- Zero existing files modified

### Rollback

```bash
git revert <commit-sha>  # safe — only added new files
```

---

## Step 2: Zod Cross-Step Schemas

- **Branch:** `refactor/cross-step-zod`
- **Depends on:** Step 1
- **Model tier:** default
- **Parallel group:** A (steps 2, 3, 4)
- **Files created:** `src/lib/schemas/cross-step.schema.ts`
- **Files modified:** `src/lib/schemas/index.ts` (add re-export)

### Context Brief

Step 1 created TypeScript interfaces for all cross-step data. This step creates matching Zod schemas for runtime validation at API boundaries. The existing `src/lib/schemas/` directory has 13 schema files for API input validation (auth, user, project, etc.) but nothing for cross-step data flow. The barrel export is at `src/lib/schemas/index.ts`. These schemas will be used in Step 5 (route.ts migration) to validate data shape when assembling previousStepData.

### Tasks

1. Create `src/lib/schemas/cross-step.schema.ts`:
   ```typescript
   import { z } from 'zod'

   // NOTE: code and spec are optional because P4.4 (line 498) uses a lighter BomEntry
   // without these fields. The aggregateBomItems() helper always includes them,
   // but legacy data may not.
   export const bomEntrySchema = z.object({
     name: z.string(),
     code: z.string().optional().default(''),
     spec: z.string().optional().default(''),
     quantity: z.string(),
     unit: z.string(),
   })

   export const estimateTotalsSchema = z.object({
     totalMaterial: z.union([z.string(), z.number()]),
     totalLabor: z.union([z.string(), z.number()]),
     totalService: z.union([z.string(), z.number()]).optional(),
     totalOverhead: z.union([z.string(), z.number()]).optional(),
     totalEstimate: z.union([z.string(), z.number()]),
     estimateFileName: z.string().optional(),
   })

   export const dt02RowSchema = z.object({
     maCP: z.string(),
     noiDung: z.string(),
     giaTri: z.string(),
     tyLe: z.string(),
   })

   export const dt03RowSchema = z.object({
     nhomVT: z.string(),
     danhMuc: z.string(),
     dvt: z.string(),
     kl: z.string(),
     donGia: z.string(),
     thanhTien: z.string(),
   })

   export const supplierEntrySchema = z.object({
     name: z.string(),
     quotes: z.array(z.object({
       material: z.string(),
       price: z.string(),
     })),
   })

   export const woItemSchema = z.object({
     costCode: z.string(),
     content: z.string(),
     jobCode: z.string(),
     typeCode: z.string(),
     unit: z.string(),
     qty1: z.string(),
     qty2: z.string(),
     totalQty: z.string(),
     startDate: z.string(),
     endDate: z.string(),
   })

   // Safe parser helper: returns typed data or null (no throw)
   export function safeParseBomItems(data: unknown): BomEntry[] | null {
     const result = z.array(bomEntrySchema).safeParse(data)
     return result.success ? result.data : null
   }
   ```

2. Update `src/lib/schemas/index.ts` — add `export * from './cross-step.schema'`

3. Verify build passes

### Verification

```bash
npx tsc --noEmit 2>&1 | grep -v "__tests__" | grep "error TS"
npm run build
```

### Exit Criteria

- Zod schemas match TypeScript interfaces from Step 1
- Safe parser helpers for critical data (BOM, estimate, supplier)
- Build passes

### Rollback

```bash
git revert <commit-sha>
```

---

## Step 3: Data Fetcher Helpers

- **Branch:** `refactor/data-fetchers`
- **Depends on:** Step 1
- **Model tier:** strongest (Opus) — extracting logic from 700-line route.ts
- **Parallel group:** A (steps 2, 3, 4)
- **Files created:** `src/lib/data-fetchers.ts`
- **Files modified:** none (additive only)

### Context Brief

`src/app/api/tasks/[id]/route.ts` (726 lines) has massive duplication:

- **BOM aggregation** (fetch P2.1+P2.2+P2.3 bomItems, merge with source labels) is copy-pasted 4 times at lines 119-149 (P3.2), 322-352 (P3.5), 356-390 (P3.3/P3.4), 473-504 (P4.4). The P4.4 variant at line 498 uses a SHORTER BomEntry type (missing `code` and `spec`).
- **Estimate fetch** (fetch P1.2 resultData) repeated 6 times at lines 206-207, 224-225, 250-251, 290-291, 405, 575.
- **Supplier data fetch** (fetch P3.5 resultData) repeated 3 times at lines 403-405, 437-438, 455-456.

This step creates a `data-fetchers.ts` helper file with shared functions. The import is `import prisma from '@/lib/db'` (existing). Types come from Step 1's `src/lib/types/cross-step-data.ts`. No existing files are modified — route.ts migration happens in Step 5.

### Tasks

1. Create `src/lib/data-fetchers.ts` with these helpers:

   ```typescript
   import prisma from '@/lib/db'
   import type { BomEntry, BomEntryWithSource } from '@/lib/types'

   /**
    * Fetch a single step's resultData for a project.
    * Used as building block for all previousStepData assembly.
    */
   export async function fetchStepResult(projectId: string, stepCode: string) {
     return prisma.workflowTask.findFirst({
       where: { projectId, stepCode },
       select: { resultData: true, status: true },
     })
   }

   /**
    * Aggregate BOM items from P2.1 + P2.2 + P2.3 with source labels.
    * Currently duplicated 4 times in route.ts (lines 134-149, 339-352, 377-390, 500-504).
    */
   export async function aggregateBomItems(projectId: string): Promise<BomEntryWithSource[]> {
     const [p21, p22, p23] = await Promise.all([
       fetchStepResult(projectId, 'P2.1'),
       fetchStepResult(projectId, 'P2.2'),
       fetchStepResult(projectId, 'P2.3'),
     ])
     const allItems: BomEntryWithSource[] = []
     const sources: Array<{ data: Record<string, unknown> | null; label: 'P2.1' | 'P2.2' | 'P2.3' }> = [
       { data: p21?.resultData as Record<string, unknown> | null, label: 'P2.1' },
       { data: p22?.resultData as Record<string, unknown> | null, label: 'P2.2' },
       { data: p23?.resultData as Record<string, unknown> | null, label: 'P2.3' },
     ]
     for (const src of sources) {
       const items = (src.data?.bomItems as BomEntry[]) || []
       for (const item of items) {
         if (item.name?.trim()) {
           allItems.push({ ...item, source: src.label })
         }
       }
     }
     return allItems
   }

   /**
    * Fetch estimate data from P1.2, optionally merged with P2.1A adjustments.
    * Currently duplicated 6 times in route.ts.
    */
   export async function fetchEstimateData(
     projectId: string,
     options?: { mergeP21A?: boolean }
   ): Promise<Record<string, unknown> | null> {
     const tasks = [fetchStepResult(projectId, 'P1.2')]
     if (options?.mergeP21A) {
       tasks.push(fetchStepResult(projectId, 'P2.1A'))
     }
     const results = await Promise.all(tasks)
     const p12Data = results[0]?.resultData as Record<string, unknown> | null
     if (!options?.mergeP21A || results.length < 2) return p12Data
     const p21aData = results[1]?.resultData as Record<string, unknown> | null
     if (!p21aData) return p12Data
     return { ...p12Data, ...p21aData }
   }

   /**
    * Fetch supplier data from P3.5.
    * Currently duplicated 3 times in route.ts.
    */
   export async function fetchSupplierData(projectId: string) {
     const task = await fetchStepResult(projectId, 'P3.5')
     return task?.resultData as Record<string, unknown> | null
   }

   /**
    * Fetch PO data from P3.7.
    * Currently duplicated 3 times in route.ts.
    */
   export async function fetchPoData(projectId: string) {
     const task = await fetchStepResult(projectId, 'P3.7')
     return task?.resultData as Record<string, unknown> | null
   }

   /**
    * Fetch plan data from P1.2A (WBS + MOM).
    * Used by P1.3, P3.1, P3.3/P3.4.
    */
   export async function fetchPlanData(projectId: string) {
     const task = await fetchStepResult(projectId, 'P1.2A')
     return task?.resultData as Record<string, unknown> | null
   }

   /**
    * Fetch material inventory for stock comparison (P3.2).
    * NOTE: P3.2 needs ALL materials (no filter), P4.5 needs stock > 0 with category + limit.
    * These are kept as SEPARATE functions because the queries differ.
    */
   export async function fetchAllMaterials() {
     return prisma.material.findMany({
       select: { materialCode: true, name: true, specification: true, currentStock: true, unit: true },
     })
   }

   /**
    * Fetch material inventory with stock > 0 for material issue (P4.5).
    * Different from fetchAllMaterials: filters stock > 0, includes category, ordered, limited to 200.
    */
   export async function fetchAvailableInventory() {
     return prisma.material.findMany({
       where: { currentStock: { gt: 0 } },
       select: { materialCode: true, name: true, specification: true, currentStock: true, unit: true, category: true },
       orderBy: { category: 'asc' },
       take: 200,
     })
   }
   ```

2. Verify build passes (no consumers yet)

### Verification

```bash
npx tsc --noEmit 2>&1 | grep -v "__tests__" | grep "error TS"
npm run build
```

### Exit Criteria

- 7 helper functions cover all duplicate patterns
- Each function documents which route.ts lines it replaces
- `fetchStepResult()` is the single DB query pattern
- Build passes

### Rollback

```bash
git revert <commit-sha>
```

---

## Step 4: Migrate page.tsx + WbsTableUI.tsx to Centralized Types

- **Branch:** `refactor/page-centralized-types`
- **Depends on:** Step 1
- **Model tier:** strongest (Opus) — modifying 6000+ line file
- **Parallel group:** A (steps 2, 3, 4)
- **Files modified:** `src/app/dashboard/tasks/[id]/page.tsx`, `src/app/dashboard/tasks/[id]/components/WbsTableUI.tsx`

### Context Brief

`page.tsx` (6029 lines) defines types locally at lines 44-49 (TeamAssign, CellAssignMap, LsxIssuedMap, MaterialReqItem, MaterialReqMap) and line 1329-1330 (SupplierQuote, SupplierEntry), line 1345 (PrevStepFile). `WbsTableUI.tsx` (817 lines) exports the SAME types at lines 6-25 but with DIFFERENT signatures — e.g., WbsTableUI's `TeamAssign` has optional `volume` and `notes`, while page.tsx's has required `volume` and no `notes`. `previousStepData` state at line 1344 uses 18 `any` fields.

The WbsTableUI component is defined INLINE in page.tsx (lines 51-1302) — it is NOT imported from the separate `WbsTableUI.tsx` file. The separate file exists but the inline version is what's used.

This step:
1. Imports centralized types from `@/lib/types`
2. Removes local type definitions
3. Replaces `any` in previousStepData with `PreviousStepDataMap` types
4. Aligns WbsTableUI.tsx exports with centralized types

### Tasks

1. **page.tsx — Replace local type definitions:**
   - Add import: `import type { TeamAssign, CellAssignMap, LsxIssuedMap, MaterialReqItem, MaterialReqMap, BomEntry, SupplierQuote, SupplierEntry, PrevStepFile, WbsRow, MomSection, MomAttendant, MomItem, QcItem, WoItem, Dt02Row, Dt03Row, DtGenericRow, EstimateTotals, PreviousStepDataMap } from '@/lib/types'`
   - Remove local `type TeamAssign` at line 44
   - Remove local `type CellAssignMap` at line 45
   - Remove local `type LsxIssuedMap` at line 46
   - Remove local `type MaterialReqItem` at line 48
   - Remove local `type MaterialReqMap` at line 49
   - Remove local `type SupplierQuote` at line 1329
   - Remove local `type SupplierEntry` at line 1330
   - Remove local `type PrevStepFile` at line 1345

2. **page.tsx — Type previousStepData properly:**
   - Replace line 1344:
     ```typescript
     // BEFORE:
     const [previousStepData, setPreviousStepData] = useState<{ plan?: any; estimate?: any; ... } | null>(null)
     // AFTER:
     const [previousStepData, setPreviousStepData] = useState<PreviousStepDataMap[keyof PreviousStepDataMap] | null>(null)
     ```
   - At each step-specific section, use type narrowing:
     ```typescript
     if (task.stepCode === 'P1.3') {
       const prev = previousStepData as PreviousStepDataMap['P1.3'] | null
       // Now prev.plan and prev.estimate are typed
     }
     ```

3. **page.tsx — Type inline component types (MOM, estimate):**
   - Remove local `type MomItem` / `type MomSection` / `type MomAttendant` definitions (around line 916-918)
   - Replace with imports from `@/lib/types`

4. **page.tsx — Handle function-scoped WbsRow in inline WbsTableUI:**
   - The inline `WbsTableUI` function (line 51) has a function-scoped `type WbsRow = Record<string, string>` at line 52
   - Remove this local type and reference the module-level import from `@/lib/types` instead
   - The `emptyRow()` function at line 53 stays as-is (it's a factory, not a type)
   - Do NOT add `galvanize` or `khungKien` to `emptyRow()` — keep existing behavior unchanged

5. **WbsTableUI.tsx — Align with centralized types:**
   - Replace local type exports (lines 6-25) with re-exports from `@/lib/types`:
     ```typescript
     import type { TeamAssign, CellAssignMap, LsxIssuedMap, MaterialReqItem, MaterialReqMap, WbsRow } from '@/lib/types'
     export type { TeamAssign, CellAssignMap, LsxIssuedMap, MaterialReqItem, MaterialReqMap, WbsRow }
     ```
   - This preserves backward compatibility for any external imports
   - NOTE: The separate WbsTableUI.tsx file appears unused (page.tsx has an inline version). Modifying it for type alignment only — no behavioral change.

6. **Verify no TypeScript errors** — the compiler will catch any field mismatches

### Verification

```bash
npx tsc --noEmit 2>&1 | grep -v "__tests__" | grep "error TS"
npm run build
npx vitest run --reporter=verbose 2>&1 | tail -20
```

### Exit Criteria

- Zero local type definitions for shared data structures in page.tsx
- WbsTableUI.tsx re-exports from centralized types
- previousStepData uses specific per-step types
- Build passes
- No new test failures

### Rollback

```bash
git revert <commit-sha>
```

---

## Step 5: Migrate route.ts to Centralized Types + Data Fetchers

- **Branch:** `refactor/route-data-fetchers`
- **Depends on:** Steps 1 + 3
- **Model tier:** strongest (Opus) — modifying critical 726-line API file
- **Parallel group:** — (serial, after Group A)
- **Files modified:** `src/app/api/tasks/[id]/route.ts`

### Context Brief

`route.ts` (726 lines) assembles `previousStepData` for 20 steps in the GET handler. It has:
- 4 inline `type BomEntry` definitions (lines 135, 338, 376, 498 — the line 498 version MISSES `code` and `spec` fields)
- 4 BOM aggregation blocks (lines 119-149, 322-352, 356-390, 473-504)
- 6 estimate fetch blocks
- 3 supplier data fetch blocks
- 1 `type PrevStepFile` at line 622

Step 3 created `data-fetchers.ts` with `aggregateBomItems()`, `fetchEstimateData()`, `fetchSupplierData()`, `fetchPoData()`, `fetchPlanData()`, `fetchMaterialInventory()`. Step 1 created centralized types.

This step replaces ALL inline type definitions and duplicate fetch logic with imports. **CRITICAL:** The P4.4 BomEntry (line 498) has only 3 fields — verify that `code` and `spec` are not needed there, or fix the aggregateBomItems output to match.

### Tasks

1. **Add imports:**
   ```typescript
   import type { BomEntry, BomEntryWithSource, PrevStepFile } from '@/lib/types'
   import {
     aggregateBomItems, fetchEstimateData, fetchSupplierData,
     fetchPoData, fetchPlanData, fetchStepResult, fetchAllMaterials, fetchAvailableInventory
   } from '@/lib/data-fetchers'
   ```

2. **Remove all 4 inline `type BomEntry` definitions** (lines 135, 338, 376, 498)

3. **Remove inline `type PrevStepFile`** (line 622) — import from `@/lib/types`

4. **Replace P3.2 block (lines 116-197):**
   ```typescript
   if (task.stepCode === 'P3.2') {
     const allPrItems = await aggregateBomItems(task.projectId)
     const materials = await fetchAllMaterials()  // NOTE: fetchAllMaterials, NOT fetchAvailableInventory
     // Stock comparison logic stays inline (it's step-specific)
     const fromStock: unknown[] = []
     const toPurchase: unknown[] = []
     for (const pr of allPrItems) {
       // ... existing comparison logic unchanged ...
     }
     previousStepData = { prItems: allPrItems, fromStock, toPurchase }
   }
   ```

5. **Replace P3.5 block (lines 322-354):**
   ```typescript
   if (task.stepCode === 'P3.5') {
     const allPrItems = await aggregateBomItems(task.projectId)
     previousStepData = { prItems: allPrItems }
   }
   ```

6. **Replace P3.3/P3.4 block (lines 356-395):**
   ```typescript
   if (['P3.3', 'P3.4'].includes(task.stepCode)) {
     const [planData, allBomItems] = await Promise.all([
       fetchPlanData(task.projectId),
       aggregateBomItems(task.projectId),
     ])
     previousStepData = { plan: planData, bomItems: allBomItems }
   }
   ```

7. **Replace P4.4 BOM aggregation (lines 473-510):**
   ```typescript
   if (task.stepCode === 'P4.4') {
     const [p43Task, supplierData, allBomItems] = await Promise.all([
       fetchStepResult(task.projectId, 'P4.3'),
       fetchSupplierData(task.projectId),
       aggregateBomItems(task.projectId),
     ])
     previousStepData = {
       qcData: p43Task?.resultData || null,
       supplierData,
       prItems: allBomItems,
     }
   }
   ```

8. **Replace all estimate fetches with `fetchEstimateData()`:**
   - P1.3 (line 206-207), P2.3 (line 224-225): `fetchEstimateData(projectId)`
   - P2.4 (lines 250-261): `fetchEstimateData(projectId, { mergeP21A: true })`
   - P2.5 (lines 290-301): `fetchEstimateData(projectId, { mergeP21A: true })`
   - P3.6 (line 405): `fetchEstimateData(projectId)`
   - P6.2 (line 575): `fetchEstimateData(projectId)`

9. **Replace supplier data fetches with `fetchSupplierData()`:**
   - P3.6 (line 403-405), P4.2 (line 437-438), P4.3 (line 455-456)

10. **Replace PO data fetches with `fetchPoData()`:**
    - P4.1 (line 426-435), P4.2 (line 437-438), P4.3 (line 455-456)

11. **Replace plan data fetches with `fetchPlanData()`:**
    - P1.3 (line 202-204), P3.1 (line 313-318)

12. **Verify behavior is IDENTICAL** — same data returned, same structure

### Verification

```bash
npx tsc --noEmit 2>&1 | grep -v "__tests__" | grep "error TS"
npm run build
npx vitest run --reporter=verbose 2>&1 | tail -20
```

### Exit Criteria

- Zero inline `type BomEntry` or `type PrevStepFile` definitions
- Zero BOM aggregation duplication (one call to `aggregateBomItems()`)
- Zero estimate fetch duplication (one call to `fetchEstimateData()`)
- Route.ts reduced by ~100-150 lines
- Build passes
- Existing tests pass

### Rollback

```bash
git revert <commit-sha>
```

---

## Step 6: Integration Tests for Cross-Step Data Flows

- **Branch:** `test/cross-step-integration`
- **Depends on:** Steps 4 + 5
- **Model tier:** strongest (Opus) — complex multi-step test scenarios
- **Parallel group:** —
- **Files created:** `src/lib/__tests__/data-fetchers.test.ts`, `src/lib/__tests__/cross-step-flow.test.ts`

### Context Brief

The centralized types (Step 1) catch compile-time errors. The data fetchers (Step 3) eliminate duplication. But we still need tests that verify:
1. Data fetcher helpers return correct shapes
2. When Step A produces data, Step B can consume it without runtime errors
3. BOM aggregation from 3 sources works correctly
4. Estimate data merging (P1.2 + P2.1A) preserves all fields

Existing test infrastructure: Vitest configured, Prisma mock at `src/lib/__mocks__/db.ts` (uses `vitest-mock-extended`), ioredis mock uses `vi.hoisted()` + class mock. 13 test files exist, 223/232 tests pass (9 failures in projects.test.ts due to NextRequest mock issue).

### Tasks

1. **Create `src/lib/__tests__/data-fetchers.test.ts`:**

   Test `aggregateBomItems()`:
   - All 3 steps have BOM items → returns merged array with source labels
   - One step has no bomItems → skips gracefully
   - Empty names filtered out (item.name?.trim())
   - Returns correct BomEntryWithSource shape

   Test `fetchEstimateData()`:
   - Without mergeP21A → returns P1.2 data only
   - With mergeP21A → returns merged P1.2 + P2.1A
   - P1.2 missing → returns null
   - P2.1A missing → returns P1.2 only

   Test `fetchSupplierData()`:
   - Returns P3.5 resultData
   - Step not found → returns null

   Test `fetchPoData()`, `fetchPlanData()`:
   - Returns correct step data
   - Step not found → returns null

   Test `fetchMaterialInventory()`:
   - Returns array with correct field mapping

2. **Create `src/lib/__tests__/cross-step-flow.test.ts`:**

   Test data shape compatibility:
   - Simulate P2.1 output → feed to `aggregateBomItems` → verify P3.2 can consume result
   - Simulate P1.2 output → feed to `fetchEstimateData` → verify P1.3 can access `totalEstimate`
   - Simulate P3.5 output → feed to `fetchSupplierData` → verify P3.6 can access `suppliers`
   - Verify `PreviousStepDataMap` types match actual data shapes

   Test regression scenarios:
   - BOM item with empty name → filtered out (not sent to downstream)
   - BOM item with missing `code` field → still included (backward compat)
   - Estimate with string vs number `totalEstimate` → both accepted by type

3. **Mock setup:**
   ```typescript
   import { prismaMock } from '@/lib/__mocks__/db'
   // Mock findFirst to return test data for specific step codes
   prismaMock.workflowTask.findFirst.mockImplementation(async (args) => {
     const stepCode = args?.where?.stepCode
     if (stepCode === 'P2.1') return { resultData: { bomItems: [...] }, status: 'COMPLETED' }
     // ...
   })
   ```

### Verification

```bash
npx vitest run src/lib/__tests__/data-fetchers.test.ts --reporter=verbose
npx vitest run src/lib/__tests__/cross-step-flow.test.ts --reporter=verbose
npx vitest run --reporter=verbose 2>&1 | tail -20
```

### Exit Criteria

- 25+ test cases covering all data fetcher helpers
- Cross-step flow tests verify data shape compatibility
- Regression scenarios documented as test cases
- All new tests pass
- No regressions in existing tests

### Rollback

```bash
git revert <commit-sha>
```

---

## Step 7: Fix Existing Failures + Full Verification

- **Branch:** `fix/test-regression-verification`
- **Depends on:** Step 6
- **Model tier:** default
- **Parallel group:** —
- **Files modified:** `src/app/api/__tests__/projects.test.ts`

### Context Brief

9 tests in `src/app/api/__tests__/projects.test.ts` fail due to `TypeError: Cannot read properties of undefined (reading 'pathname')` at `src/lib/with-error-handler.ts:30`. The issue is that the test creates a `new Request(...)` but `with-error-handler.ts` accesses `req.nextUrl.pathname` which only exists on `NextRequest`, not `Request`. This is a pre-existing bug from before this refactoring, but fixing it here ensures a clean baseline.

### Tasks

1. **Fix projects.test.ts** — Replace `new Request(url, opts)` with `new NextRequest(url, opts)`:
   ```typescript
   import { NextRequest } from 'next/server'
   // Replace all:
   const req = new Request('http://localhost/api/projects', { ... })
   // With:
   const req = new NextRequest('http://localhost/api/projects', { ... })
   ```

2. **Run full test suite** — verify all 232+ tests pass

3. **Run full build verification:**
   ```bash
   npx tsc --noEmit 2>&1 | grep -v "__tests__" | grep "error TS"
   npm run build
   npx vitest run --reporter=verbose
   ```

4. **Document final state** — update CLAUDE.md if needed:
   - Add `src/lib/types/cross-step-data.ts` to critical files table
   - Add `src/lib/data-fetchers.ts` to critical files table
   - Update "Adding a new field to a workflow step" pattern to include type update

### Verification

```bash
npx tsc --noEmit 2>&1 | grep -v "__tests__" | grep "error TS"  # Must be empty
npm run build                                                      # Must succeed
npx vitest run --reporter=verbose                                  # ALL tests pass
```

### Exit Criteria

- ALL tests pass (0 failures)
- Build passes with zero TS errors
- CLAUDE.md updated with new critical files and patterns
- Team knows: "Change a cross-step type → compiler shows ALL affected files"

### Rollback

```bash
git revert <commit-sha>
```

---

## Execution Summary

| Step | Name | Depends | Parallel | Model | Risk | Files Modified |
|------|------|---------|----------|-------|------|----------------|
| 1 | Centralized types | — | — | default | ZERO | +2 new files |
| 2 | Zod cross-step schemas | 1 | A | default | ZERO | +1 new, 1 edit |
| 3 | Data fetcher helpers | 1 | A | strongest | ZERO | +1 new file |
| 4 | Migrate page.tsx | 1 | A | strongest | HIGH | 2 files (6800 LOC) |
| 5 | Migrate route.ts | 1, 3 | — | strongest | HIGH | 1 file (726 LOC) |
| 6 | Integration tests | 4, 5 | — | strongest | LOW | +2 new files |
| 7 | Fix tests + verify | 6 | — | default | LOW | 1 test file |

**Critical path:** 1 → 3 → 5 → 6 → 7
**Max parallelism:** 3 concurrent (steps 2 + 3 + 4 after step 1)
**Total new files:** 6
**Total modified files:** 4 (route.ts, page.tsx, WbsTableUI.tsx, projects.test.ts)

---

## Cross-Step Dependency Map (Reference)

After this refactoring, ALL these dependencies are enforced by TypeScript compiler:

```
P1.2  ──estimate──→ P1.3, P2.3, P2.4, P2.5, P3.6, P6.2
P1.2A ──plan──────→ P1.3, P3.1, P3.3, P3.4
P2.1  ──bomItems──→ P3.2, P3.3, P3.4, P3.5, P4.4
P2.2  ──bomItems──→ P3.2, P3.3, P3.4, P3.5, P4.4
P2.3  ──bomItems──→ P3.2, P3.3, P3.4, P3.5, P4.4
P2.1A ──estimate──→ P2.4, P2.5
P3.5  ──suppliers─→ P3.6, P3.7, P4.2, P4.3
P3.7  ──poData────→ P4.1, P4.2, P4.3
P4.3  ──qcData────→ P4.4
P3.3  ──lsxData───→ P4.5
P3.4  ──woData────→ P4.5
P5.1  ──jobCard───→ P5.2, P5.4
P5.2  ──volume────→ P5.4
P6.1-4 ──status───→ P6.5
```

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

## Review Log

- **2026-04-03:** Adversarial review by Opus sub-agent identified 5 CRITICAL, 5 WARNING, 5 INFO findings. All 5 criticals fixed:
  - C1: `LsxIssuedMap` — documented canonical choice (`boolean` from page.tsx inline, not `{status,details}` from unused WbsTableUI.tsx)
  - C2: `PrevStepFile.createdAt` — changed from `string` to `string | Date` to handle Prisma/JSON boundary
  - C3: `fetchMaterialInventory()` — split into `fetchAllMaterials()` (P3.2) and `fetchAvailableInventory()` (P4.5) with different queries
  - C4: `MaterialReqItem` — added missing `qty?: string` field (legacy alias used in WbsTableUI paths)
  - C5: `departmentEstimates` — documented in PreviousStepDataMap comment; only appears in state declaration, never sent from API
  - Also fixed: `PrevDataP62.budgetTotal` typed as `number` (not `unknown`), `bomEntrySchema` made `code`/`spec` optional, `PrevDataP32.toPurchase` added missing `specMatch` field, Step 4 addresses function-scoped `WbsRow` in inline WbsTableUI
