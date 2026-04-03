# Blueprint: P1.2 Estimate Overhaul — Match Real Excel Template

**Objective:** Overhaul step P1.2 to match the production Excel template (8 sheets: DT01-DT07 + Cover). Two deliverables: (1) multi-sheet Excel template with cross-sheet formulas, (2) complete on-screen display including DT02/DT07 (currently only in P2.1A) + DT01 project info + Cover summary visible at P1.3 for BGD approval.

**Created:** 2026-04-03
**Status:** Final (post-review)
**Branch strategy:** Direct to `main`

---

## Current State (Verified)

### P1.2 currently renders (page.tsx:1948-2118)
- **DT03** — 7 default rows (VTC, VTP, VTDK, VTBP, VTTH, VTS, VTDP) — material summary
- **DT04** — detailed BOM (maVT, tenVT, macVL, quyCach, dvt, kl, donGia, thanhTien)
- **DT05** — 4 default rows (VT, NDT, MK, CPK) — outsource services
- **DT06** — 16 default rows — labor costs
- 21 currency form fields (mat_*, lab_*, out_*, ovh_*) + 1 readonly totalEstimate
- Dynamic single-sheet Excel export
- 1 attachment slot (detail_estimate)

### DT02 and DT07 ALREADY EXIST in codebase (rendered for P2.1A, NOT P1.2)
- **DT02** (page.tsx:2412-2428) — 7 rows: I-VII cost categories (maCP, noiDung, giaTri, tyLe)
- **DT07** (page.tsx:2429-2455) — 23 rows: CPC(10), CTC(5), CQL(5) + headers (maCP, danhMuc, dvt, kl, donGia, thanhTien)
- Data keys `dt02Items`, `dt07Items` already in ensuredKeys (line 1348, 1353)
- Conditional rendering: `task.stepCode === 'P2.1A'` (line 1357) — need to add `'P1.2'`

### P1.3 approval (page.tsx:1576-1680)
- Fetches `previousStepData.estimate` (P1.2 data) but **only renders P1.2A plan**
- Estimate data is fetched but NOT displayed
- Gate: `['P1.2A']` only — P1.2 not required (workflow-constants.ts:42)
- `rejectTo: 'P1.2A'` — no mechanism to reject estimate back to P1.2

### What's MISSING
| Item | Status |
|------|--------|
| DT01 project info display in P1.2 | **Not implemented** |
| DT02/DT07 rendering in P1.2 | **Exists for P2.1A, need to enable for P1.2** |
| DT02 auto-calculation from DT03-DT07 | **Not implemented** |
| Multi-sheet Excel template | **Not implemented** (single sheet only) |
| P1.3 estimate display for approval | **Data fetched, UI not rendered** |
| P1.3 gate includes P1.2 | **Missing** — P1.3 can open before P1.2 done |
| Dual reject (plan → P1.2A, estimate → P1.2) | **Not implemented** |

---

## Step Plan (5 Steps)

### Step 1: Enable DT02/DT07 for P1.2 + Add DT01 project info
**Files:** `src/app/dashboard/tasks/[id]/page.tsx`, `src/lib/step-form-configs.ts`
**Depends on:** None
**Model tier:** Default

#### Context
DT02 and DT07 tables already exist (rendered for P2.1A at lines 2412-2455). They use `renderEstTable()` with existing column definitions and default rows. P1.2 just needs to render them too.

#### Tasks
1. **Enable DT02/DT07 rendering for P1.2** — In the ensuredKeys conditional (line 1356-1358), add `'P1.2'` to the DT02/DT07 branch:
   ```typescript
   (task.stepCode === 'P2.1A' && ['dt02Items','dt07Items'].includes(key))
   // change to:
   (['P1.2', 'P2.1A'].includes(task.stepCode) && ['dt02Items','dt07Items'].includes(key))
   ```

2. **Add DT02 + DT07 table rendering** in the P1.2 section (after DT06, before attachments):
   - Reuse exact same column definitions and default rows as P2.1A (lines 2412-2455)
   - DT02 goes FIRST (summary), then DT03-DT07 detail tables
   - Layout order: DT01 info → DT02 summary → DT03 → DT04 → DT05 → DT06 → DT07

3. **Add DT01 project info card** at the TOP of P1.2 display (before DT02):
   - Read-only card showing project data auto-filled from `task.project`:
     - Mã dự án, Khách hàng, Tên dự án, Nội dung công việc
     - Giá trị HĐ (contractValue), Ngày ký, Tiến độ giao hàng
   - Plus editable fields: Khối lượng thi công (text), Đợt thanh toán (textarea), Điều khoản phạt (textarea)
   - Store in formData as `dt01_volume`, `dt01_paymentTerms`, `dt01_penalties`

4. **Add DT02 auto-calculation** — After any DT03/DT05/DT06/DT07 table changes, auto-update DT02 rows:
   ```
   I.  Chi phí VT = SUM(dt03Items thanhTien)
   II. Chi phí NC = SUM(dt06Items thanhTien)
   III.Chi phí DV = SUM(dt05Items thanhTien)
   IV-VI. Chi phí chung = SUM(dt07Items thanhTien grouped by CPC/CTC/CQL)
   ```
   - Also update `totalEstimate` from DT02 totals

5. **Update step-form-configs.ts** P1_2 config:
   - Add `dt01_volume`, `dt01_paymentTerms`, `dt01_penalties` as form fields
   - Add checklist item: `dt02_verified` — "Đã kiểm tra tổng hợp DT02 khớp với chi tiết"
   - Keep existing checklist items

#### Verification
- P1.2 renders: DT01 card → DT02 summary → DT03 → DT04 → DT05 → DT06 → DT07
- DT02 auto-calculates when table data changes
- `totalEstimate` updates correctly
- Data saves/restores correctly (reload page → data intact)
- `npx tsc --noEmit` passes

---

### Step 2: Build multi-sheet Excel template
**Files:** `src/app/dashboard/tasks/[id]/page.tsx` (Excel export section)
**Depends on:** Step 1
**Model tier:** Default

#### Context
Current export (lines 5015-5031) uses `xlsx` library to create a single-sheet workbook. The real template has 8 sheets with cross-sheet formulas. SheetJS can write formula strings (Excel evaluates on open).

#### Tasks
1. **Replace single-sheet export** with multi-sheet workbook for P1.2:

   **Sheet: +Cover** — Project summary
   - Rows: company header, project code, contract no, total value (formula: `=DT02!C_total`), approval line
   
   **Sheet: DT01 (TTC)** — Project info
   - Pre-fill from formData (dt01_* fields + project data)
   - P&L section with formulas referencing DT02

   **Sheet: DT02 (TH)** — Cost summary
   - Pre-fill from dt02Items
   - Column formulas: `=SUM(G5:G${lastRow})` for totals (dynamic row refs)

   **Sheets: DT03, DT04, DT05, DT06, DT07** — Detail tables
   - Pre-fill from respective `dt*Items` formData
   - Each sheet has subtotal row with `=SUM()` formula
   - DT02 references these subtotals

2. **Formula strategy** — Use dynamic cell references:
   - Calculate actual last data row based on items count
   - Use `=SUM(G2:G${lastDataRow})` instead of hardcoded G32
   - Add note: formulas evaluate when opened in Excel, not in browser

3. **Multi-sheet import** — When uploading Excel:
   - Detect sheet names matching DT03/DT04/DT05/DT06/DT07
   - Parse each sheet and update corresponding formData keys
   - Fallback: if only 1 sheet, use existing import logic

4. Keep backward compatibility with old single-sheet uploads.

#### Verification
- Download → open in Excel → 8 sheets present, formulas work
- Upload filled template → all tables populated correctly
- Old single-sheet upload still works

---

### Step 3: Display estimate at P1.3 + Dual approval
**Files:** `src/app/dashboard/tasks/[id]/page.tsx`, `src/lib/workflow-constants.ts`, `src/lib/step-form-configs.ts`
**Depends on:** Step 1
**Model tier:** Default (strongest for dual-approval logic)

#### Context
P1.3 (lines 1576-1680) currently shows only P1.2A plan data. It fetches `previousStepData.estimate` but never renders it. BGĐ needs to see + approve the estimate too. 

The existing dual-decision pattern is at lines 887-892: `planDecision`/`estimateDecision` states already exist but only `planDecision` is used.

#### Tasks
1. **Update P1.3 gate** in workflow-constants.ts:
   ```typescript
   // Line 42: change from
   gate: ['P1.2A'],
   // to
   gate: ['P1.2A', 'P1.2'],
   ```
   This ensures P1.3 only activates when BOTH plan AND estimate are complete.

2. **Add estimate display section** to P1.3 UI (after plan approval section):
   - Section header: "📊 Dự toán thi công (từ P1.2)"
   - **Cover summary card** (readonly): project code, contract value, total estimate, profit margin
   - **DT02 summary table** (readonly): cost categories with values and percentages
   - **DT03 material table** (readonly, collapsible)
   - **DT04 BOM** (readonly, collapsible)
   - **DT06 labor table** (readonly, collapsible)
   - **DT07 overhead table** (readonly, collapsible)
   - Reuse `renderReadonlyTable()` helper (already exists at line 2883 for P2.5)

3. **Implement dual-approval flow:**
   - "✅ Duyệt kế hoạch" button → calls `action: 'save'` with `{ planApproved: true }` in resultData (NOT complete)
   - "✅ Duyệt dự toán" button → calls `action: 'save'` with `{ estimateApproved: true }` in resultData
   - "❌ Từ chối kế hoạch" → existing reject flow (rejectTo: P1.2A)
   - "❌ Từ chối dự toán" → new reject button calling `/api/tasks/${taskId}/reject` with body `{ reason, overrideRejectTo: 'P1.2' }`
   - "✅ Hoàn thành bước" button only enabled when `planApproved && estimateApproved`
   - On page load, restore decision states from saved resultData (existing pattern at lines 977-981)

4. **Update P1.3 config checklist:**
   - Add: `estimate_reviewed` — "Đã review dự toán thi công" (required)

5. **Verify reject flow** — Check `workflow-engine.ts` supports `overrideRejectTo`:
   - The reject API at `/api/tasks/[id]/reject` should accept `overrideRejectTo` in body
   - When estimate is rejected, P1.2 reactivates but P1.2A stays DONE

#### Verification
- P1.3 shows both plan (P1.2A) AND estimate (P1.2) data
- Can approve plan and estimate independently
- Can reject estimate → P1.2 reactivates, P1.2A unaffected
- Can't complete P1.3 without both approvals
- Reload P1.3 → approval states persist
- `npx tsc --noEmit` passes

---

### Step 4: Data backward compatibility + downstream verification
**Files:** `src/app/dashboard/tasks/[id]/page.tsx`, `src/app/api/tasks/[id]/route.ts`
**Depends on:** Step 1
**Model tier:** Default

#### Context
Some projects may have P1.2 data saved with the OLD format (21 currency fields like `mat_main: 50000000`). After the overhaul, tables are the source of truth. Also, downstream steps (P2.4, P2.5, P6.2) read `totalEstimate` from P1.2 resultData.

#### Tasks
1. **Auto-migrate old format data** — In `loadTask()` for P1.2:
   - If resultData has `mat_main` but NO `dt03Items`, auto-populate DT03 rows from old fields:
     ```
     mat_main → VTC row thanhTien
     mat_accessory → VTP row thanhTien
     mat_packing → VTDK row thanhTien
     mat_method → VTBP row thanhTien
     mat_consumable → VTTH row thanhTien
     mat_paint → VTS row thanhTien
     mat_reserve → VTDP row thanhTien
     ```
   - Similarly for DT06 (lab_* → DT06 rows) and DT05 (out_* → DT05 rows)
   - Old `ovh_*` fields → DT07 rows

2. **Ensure `totalEstimate` always saved** — When P1.2 submits:
   - Auto-calculate from DT02/table sums before saving
   - Store both `totalEstimate` (backward compat) and individual totals (`totalMaterial`, `totalLabor`, `totalService`, `totalOverhead`)

3. **Remove redundant currency form fields** from P1.2 config:
   - Remove the 21 `mat_*`, `lab_*`, `out_*`, `ovh_*` fields from step-form-configs.ts
   - Keep `totalEstimate` as readonly auto-calculated
   - The `totalEstimate` auto-calc logic (page.tsx line 1098-1101) must be updated to sum from tables instead of currency fields

4. **Verify downstream consumers:**
   - P2.4 (route.ts:236): reads `previousStepData.estimate` — still gets full resultData ✓
   - P2.5 (route.ts:271): reads `previousStepData.estimate` — same ✓
   - P6.2 (route.ts:573): reads `budgetTotal = Number(rd.totalEstimate || 0)` — ✓ if totalEstimate saved
   - P2.4 page rendering: check if it reads any specific currency fields from estimate data

#### Verification
- Load P1.2 with old-format data → tables auto-populate from currency fields
- Complete P1.2 → `totalEstimate` in resultData matches table sums
- P2.4/P2.5/P6.2 load correctly with new data format
- `npx tsc --noEmit` passes
- `npm run build` succeeds

---

### Step 5: Integration test + cleanup
**Files:** All modified files
**Depends on:** Steps 1-4
**Model tier:** Default

#### Tasks
1. Verify complete flow:
   - P1.1 → P1.1B approve → P1.2 opens
   - P1.2: DT01 auto-fills from project, all 7 sections display
   - Edit DT03/DT06 → DT02 auto-updates
   - Download Excel → 8 sheets with formulas
   - Upload filled Excel → tables populate
   - Complete P1.2 → P1.3 opens (gate now requires both P1.2A + P1.2)
   - P1.3: BGĐ sees plan + full estimate
   - Approve both → next steps activate

2. Run `npx tsc --noEmit` — fix any errors
3. Run `npm run build` — verify production build
4. Commit and push to main

#### Exit Criteria
- All steps complete, code on `main`, build green
- P1.2 matches real Excel template structure
- P1.3 shows full estimate for BGĐ approval

---

## Dependency Graph

```
Step 1 (Enable DT02/DT07 + DT01 in P1.2)
    │
    ├──→ Step 2 (Multi-sheet Excel template)
    │
    ├──→ Step 3 (P1.3 estimate display + dual approval)
    │
    └──→ Step 4 (Data migration + downstream compat)
              │
    All ──→ Step 5 (Integration test + cleanup)
```

**Parallel:** Steps 2, 3, 4 can run in parallel after Step 1.

## Agent Allocation

| Agent | Steps | Focus |
|-------|-------|-------|
| Agent A | Step 1 | Enable DT02/DT07 for P1.2 + DT01 info + auto-calc |
| Agent B | Step 2 | Multi-sheet Excel generator (isolated) |
| Agent C | Step 3 | P1.3 display + dual approval + gate fix |
| Agent D | Step 4 | Data migration + downstream compat |
| Main | Step 5 | Integration test |

## Risk Mitigations

| Risk | Mitigation |
|------|------------|
| Old P1.2 data format breaks | Step 4: auto-migration from currency fields to tables |
| P1.3 opens before P1.2 done | Step 3: update gate to `['P1.2A', 'P1.2']` |
| Excel formulas don't evaluate | SheetJS writes formula strings; Excel recalculates on open — document this |
| DT02 schema conflict between P1.2 and P2.1A | Use identical schema (both render same columns/defaults) |
| Reject estimate sends to wrong step | Step 3: use `overrideRejectTo: 'P1.2'` for estimate rejection |
