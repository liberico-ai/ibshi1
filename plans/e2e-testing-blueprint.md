# Blueprint: E2E Testing — Tính năng & Workflow người dùng

**Objective:** Xây dựng bộ test End-to-End toàn diện kiểm tra tất cả tính năng và luồng nghiệp vụ của hệ thống IBS-ERP từ góc nhìn người dùng.

**Date:** 2026-04-03  
**Mode:** Branch/PR workflow (git + gh available)  
**Base branch:** `main`  
**Framework:** Playwright (đã cấu hình sẵn)

---

## Hiện trạng

### Đã có
- `e2e/workflow.spec.ts` — 649 dòng, test workflow 32 bước P1.1→P6.1 + rejection flow
- Playwright config với Chromium, baseURL `localhost:3000`
- 10 test accounts đã define cho tất cả roles
- Helper functions: `getToken()`, `createProject()`, `completeTaskAPI()`, `loginBrowser()`

### Chưa có (cần bổ sung)
- Test login/logout & session management
- Test RBAC — quyền truy cập theo role
- Test CRUD cho từng module: HR, Finance, Warehouse, QC, Production, Design, Safety, Subcontracts
- Test navigation & dashboard theo role
- Test cross-module workflows (procurement→warehouse→production)
- Test validation, error handling, negative paths
- Test reports & data filtering
- Test data management strategy (seeding, cleanup)
- CI integration

---

## Test Data Management Strategy

### Database
- Sử dụng **cùng database** nhưng tạo data với prefix `E2E-` + `Date.now()` để tránh conflict
- Mỗi spec file tự tạo data cần thiết trong `beforeAll` và cleanup trong `afterAll`
- Unique identifiers dùng format: `E2E-{module}-{timestamp}` (e.g., `E2E-HR-1712102400000`)

### Global Setup
- `e2e/global-setup.ts` — login tất cả 10 roles, lưu tokens vào file tạm
- `e2e/global-teardown.ts` — cleanup entities có prefix `E2E-` (optional, chạy khi cần)

### Playwright Config Updates
- Thêm `webServer` block để auto-start Next.js dev server
- Thêm `globalSetup` và `globalTeardown`
- Set `fullyParallel: true` cho independent spec files

---

## CI Integration

### GitHub Actions Workflow
- File: `.github/workflows/e2e.yml`
- Trigger: PR to `main`, manual dispatch
- Steps: install → build → start server → run Playwright → upload artifacts
- Database: sử dụng PostgreSQL service container hoặc connect tới test DB
- Artifacts: screenshots + traces uploaded on failure

### Playwright Config for CI
```typescript
// playwright.config.ts additions
webServer: {
  command: 'npm run dev',
  url: 'http://localhost:3000',
  reuseExistingServer: !process.env.CI,
},
```

---

## Roles Reference (dùng trong tất cả steps)

| Key | Username | Role Code | Tên vai trò | Dùng cho modules |
|-----|----------|-----------|-------------|------------------|
| PM | giangdd | R02 | Quản lý Dự án | Projects, Tasks, Design |
| BGD | toandv | R01 | Ban Giám đốc | Approve tất cả, Admin |
| KTKH | samld | R03 | Kinh tế Kế hoạch | Finance, Salary, Budget |
| TK | luudt | R04 | Thiết kế | Design, BOM, Drawings |
| KHO | luongnth | R05 | Kho | Warehouse, Stock, GRN |
| QLSX | toanpd | R06 | Quản lý Sản xuất | Production, Work Orders |
| TSX | trungdv | R06b | Tổ trưởng SX | Job Cards, Piece Rate |
| TM | hungth | R07 | Thương mại | Procurement, PO, Vendors |
| KT | doannd | R08 | Kế toán | Finance, Invoices, Payments |
| QC | haitq | R09 | Chất lượng | Inspections, NCR, Certs |

---

## Dependency Graph

```
Step 1 (shared helpers + config)
  ├── Step 2 (auth)          ┐
  ├── Step 3 (RBAC)          ├── parallel (no data deps)
  ├── Step 4 (projects)      ┤
  ├── Step 5 (HR)            ┤
  ├── Step 6 (Warehouse)     ┤
  ├── Step 7 (Finance)       ┤
  ├── Step 8 (QC)            ┤
  ├── Step 9 (Production)    ┤
  ├── Step 10 (Design)       ┤
  ├── Step 11 (Secondary)    ┘
  ├── Step 12 (cross-module) ← depends on 4-11
  └── Step 13 (dashboard)    ← depends on 4-11
```

---

## Step 1: Shared E2E Helpers, Fixtures & Config

**Branch:** `e2e/step-1-shared-helpers`  
**Model tier:** default  
**Depends on:** none  
**Files:** `e2e/helpers.ts`, `e2e/fixtures.ts`, `e2e/test-data.ts`, `e2e/global-setup.ts`, `e2e/global-teardown.ts`, `playwright.config.ts`

### Context Brief
Tách helper functions từ `workflow.spec.ts` thành module dùng chung. Tạo Playwright fixtures cho auth context. Cấu hình test data management và CI-ready config.

### Tasks
- [ ] Tạo `e2e/helpers.ts` — extract `getToken()`, `createProject()`, `completeTaskAPI()`, `rejectTaskAPI()`, `waitForTask()`, `fastForwardStep()`, `loginBrowser()` từ `workflow.spec.ts`
- [ ] Tạo `e2e/fixtures.ts` — Playwright custom fixtures:
  - `authenticatedAPI(role)` — trả về `APIRequestContext` với Bearer token đã attach
  - `authenticatedPage(role)` — trả về `Page` đã login sẵn
  - `allTokens` — object chứa token của tất cả 10 roles
- [ ] Tạo `e2e/test-data.ts` — constants: USERS, sample data factories (`createTestVendor()`, `createTestMaterial()`, `createTestEmployee()`, etc.) với unique prefix `E2E-{module}-{Date.now()}`
- [ ] Tạo `e2e/global-setup.ts` — pre-login tất cả roles, lưu tokens
- [ ] Tạo `e2e/global-teardown.ts` — optional cleanup entities prefix `E2E-`
- [ ] Update `playwright.config.ts`:
  - Thêm `webServer` block (auto-start `npm run dev`)
  - Thêm `globalSetup` và `globalTeardown`
  - Set `fullyParallel: true`
- [ ] Update `workflow.spec.ts` để import từ helpers thay vì define inline
- [ ] Verify: `npx playwright test e2e/workflow.spec.ts` vẫn pass

### Exit Criteria
- Helper module exportable, không duplicate code
- Existing workflow test vẫn pass 100%
- Fixtures tự động handle login/token cho mỗi role
- `playwright.config.ts` CI-ready

---

## Step 2: Auth & Session Management Tests

**Branch:** `e2e/step-2-auth`  
**Model tier:** default  
**Depends on:** Step 1  
**Files:** `e2e/auth.spec.ts`

### Context Brief
Test đầy đủ luồng authentication: login, logout, session expiry, wrong credentials, rate limiting. Sử dụng fixtures từ Step 1.

### Tasks
- [ ] Test login thành công — login lần lượt với PM (R02), BGD (R01), KT (R08), redirect đến `/dashboard`
- [ ] Test login thất bại — sai username, sai password → hiển thị thông báo lỗi trên UI
- [ ] Test rate limiting — login sai 6 lần liên tiếp với 1 IP → response 429
- [ ] Test session persistence — login PM → reload page → vẫn ở `/dashboard`, không redirect về `/login`
- [ ] Test logout — click logout → sessionStorage cleared → redirect `/login`
- [ ] Test protected routes — truy cập `/dashboard/projects` khi chưa login → redirect `/login`
- [ ] Test API authentication — `GET /api/projects` không có token → 401
- [ ] Test API với token invalid/expired → 401
- [ ] **Negative:** Login với username trống, password trống → validation error

### Verification
```bash
npx playwright test e2e/auth.spec.ts --reporter=list
```

### Exit Criteria
- 9+ test cases pass
- Cover happy path + negative path cho auth flow

---

## Step 3: RBAC & Permission Tests

**Branch:** `e2e/step-3-rbac`  
**Model tier:** default  
**Depends on:** Step 1  
**Files:** `e2e/rbac.spec.ts`

### Context Brief
Kiểm tra quyền truy cập theo role. Mỗi role chỉ thấy menu items và data thuộc phạm vi mình. Tham chiếu `/src/lib/constants.ts` cho menu definitions và `/src/lib/rbac-rules.ts` cho permission rules.

### Tasks
- [ ] Test sidebar menu visibility (login UI, kiểm tra DOM):
  - Login BGD (R01): thấy tất cả 10 menu groups
  - Login PM (R02): thấy Projects, Production, Warehouse, QC — KHÔNG thấy "Quản trị" group
  - Login KHO (R05): thấy Kho — KHÔNG thấy Finance, HR  
  - Login KT (R08): thấy Tài chính — KHÔNG thấy Sản xuất
  - Login Admin (R10): thấy Hệ thống
- [ ] Test row-level security (API):
  - Login BGD → `GET /api/projects` → trả về tất cả projects
  - Login PM → `GET /api/projects` → chỉ projects mình quản lý (pmUserId match)
  - Login KHO → `GET /api/projects` → chỉ projects có task assign cho mình
- [ ] Test API permission denied:
  - Login KHO → `POST /api/projects` → 403/401
  - Login PM → `DELETE /api/users/1` → 403
  - Login TK → `POST /api/hr/salary/calculate` → 403
- [ ] Test admin pages:
  - Login PM → navigate `/dashboard/admin` → không thấy nội dung admin
  - Login BGD → navigate `/dashboard/admin` → hiển thị stats
  - Login R10 → navigate `/dashboard/users` → hiển thị danh sách users

### Verification
```bash
npx playwright test e2e/rbac.spec.ts --reporter=list
```

### Exit Criteria
- Cover 6 roles: R01, R02, R05, R08, R09, R10
- Verify cả UI (menu visibility) và API (permission denied responses)

---

## Step 4: Projects & Tasks Module Tests

**Branch:** `e2e/step-4-projects`  
**Model tier:** default  
**Depends on:** Step 1  
**Files:** `e2e/projects.spec.ts`

### Context Brief
Test CRUD cho module Projects và Tasks — module core của hệ thống. Login PM (R02) cho create/update, BGD (R01) cho approve.

### Tasks
- [ ] **Project CRUD (login PM):**
  - Tạo project qua API `POST /api/projects` — verify response
  - Xem danh sách projects tại `/dashboard/projects` — verify table hiển thị
  - Xem chi tiết project tại `/dashboard/projects/[id]` — verify thông tin
  - Update project `PUT /api/projects/[id]` — verify changes
  - Close project `PATCH /api/projects/[id]`
- [ ] **Task management:**
  - Xem task list tại `/dashboard/tasks` — verify danh sách
  - Xem chi tiết task tại `/dashboard/tasks/[id]` — verify form
  - Complete task — verify status changes
  - Add comment `POST /api/tasks/[id]/comments` — verify comment appears
  - View task history `GET /api/tasks/[id]/history`
- [ ] **Negative tests:**
  - Tạo project thiếu required fields → validation error
  - Tạo project với projectCode trùng → error
  - Login KHO (R05) → POST /api/projects → 403

### Verification
```bash
npx playwright test e2e/projects.spec.ts --reporter=list
```

### Exit Criteria
- Full project CRUD cycle
- Task complete + comment + history verify

---

## Step 5: HR Module Tests

**Branch:** `e2e/step-5-hr`  
**Model tier:** default  
**Depends on:** Step 1  
**Files:** `e2e/hr.spec.ts`

### Context Brief
Test CRUD và workflow cho module Nhân sự. Login KTKH (R03) cho salary/attendance, BGD (R01) cho employee management.

### Tasks
- [ ] **Employee management (login BGD R01):**
  - Tạo employee qua API `POST /api/hr/employees` với data `{fullName: "E2E-HR-...", ...}`
  - Xem danh sách employees tại `/dashboard/hr/employees`
  - Xem chi tiết employee
- [ ] **Contracts (login BGD R01):**
  - Tạo hợp đồng `POST /api/hr/contracts` cho employee vừa tạo
  - Xem danh sách contracts tại `/dashboard/hr/contracts`
- [ ] **Attendance (login KTKH R03):**
  - Ghi nhận chấm công `POST /api/hr/attendance`
  - Xem lịch sử chấm công tại `/dashboard/hr/attendance`
- [ ] **Timesheets (login PM R02):**
  - Tạo timesheet `POST /api/hr/timesheets`
  - Xem danh sách tại `/dashboard/hr/timesheets`
- [ ] **Salary (login KTKH R03):**
  - Tính lương `POST /api/hr/salary/calculate`
  - Xem bảng lương tại `/dashboard/hr/salary`
- [ ] **Piece rate (login QLSX R06):**
  - Tạo hợp đồng khoán `POST /api/hr/piece-rate-contracts`
  - Ghi nhận sản lượng `POST /api/hr/piece-rate-output`
  - Xem tại `/dashboard/hr/piece-rate` và `/dashboard/hr/piece-rate-output`
- [ ] **Departments (login BGD R01):**
  - Xem danh sách tại `/dashboard/hr/departments`
  - Tạo department `POST /api/departments` với name `E2E-DEPT-{timestamp}`
- [ ] **Negative tests:**
  - Tạo employee thiếu required fields → validation error
  - Login KHO (R05) → POST /api/hr/salary/calculate → 403

### Verification
```bash
npx playwright test e2e/hr.spec.ts --reporter=list
```

### Exit Criteria
- CRUD operations cho tất cả HR sub-modules
- Data tạo ra verify qua API GET
- Permission denied cho unauthorized roles

---

## Step 6: Warehouse & Procurement Module Tests

**Branch:** `e2e/step-6-warehouse`  
**Model tier:** default  
**Depends on:** Step 1  
**Files:** `e2e/warehouse.spec.ts`

### Context Brief
Test luồng mua hàng — nhập kho — xuất kho. Login TM (R07) cho procurement, KHO (R05) cho warehouse, BGD (R01) cho approve.

### Tasks
- [ ] **Vendor management (login TM R07):**
  - Tạo vendor `POST /api/vendors` với name `E2E-VENDOR-{timestamp}`
  - Xem danh sách tại `/dashboard/warehouse/vendors`
- [ ] **Material catalog (login KHO R05):**
  - Seed materials `POST /api/materials/seed`
  - Xem danh sách tại `/dashboard/warehouse`
- [ ] **Purchase Request flow (login KHO R05):**
  - Tạo PR `POST /api/purchase-requests` với line items
  - Approve PR `POST /api/purchase-requests/[id]/approve`
  - Xem chi tiết tại `/dashboard/warehouse/purchase-requests`
- [ ] **Purchase Order flow (login TM R07):**
  - Convert PR to PO `POST /api/purchase-orders/convert`
  - Tạo PO trực tiếp `POST /api/purchase-orders`
  - Approve PO `POST /api/purchase-orders/[id]/approve`
  - Xem tại `/dashboard/warehouse/purchase-orders`
- [ ] **Goods Receipt — GRN (login KHO R05):**
  - Tạo phiếu nhập kho `POST /api/grn`
  - Verify stock tăng qua `GET /api/warehouse/stats`
  - Xem tại `/dashboard/warehouse/grn`
- [ ] **Stock movements (login KHO R05):**
  - Ghi nhận stock movement `POST /api/stock-movements`
  - Xem lịch sử tại `/dashboard/warehouse/movements`
- [ ] **Warehouse overview:**
  - Xem tồn kho tổng hợp tại `/dashboard/warehouse`
  - Xem warehouse stats `GET /api/warehouse/stats`
  - Xem warehouse detail tại `/dashboard/warehouse/[id]`
- [ ] **Material issue (login KHO R05):**
  - Xuất kho `POST /api/warehouse/[id]` action: issue
  - Verify stock giảm
  - Xem tại `/dashboard/warehouse/material-issue`
- [ ] **Negative tests:**
  - Tạo PR thiếu required fields → validation error
  - Xuất kho vượt quá stock → error

### Verification
```bash
npx playwright test e2e/warehouse.spec.ts --reporter=list
```

### Exit Criteria
- Full procurement cycle: PR → PO → GRN → Stock → Issue
- Stock quantities verify đúng sau mỗi bước

---

## Step 7: Finance Module Tests

**Branch:** `e2e/step-7-finance`  
**Model tier:** default  
**Depends on:** Step 1  
**Files:** `e2e/finance.spec.ts`

### Context Brief
Test CRUD và workflow cho module Tài chính. Login KT (R08) cho invoices/payments, KTKH (R03) cho budgets.

### Tasks
- [ ] **Invoice management (login KT R08):**
  - Tạo invoice `POST /api/finance/invoices`
  - Xem danh sách tại `/dashboard/finance/invoices`
  - Xem chi tiết invoice
- [ ] **Payment recording (login KT R08):**
  - Ghi nhận thanh toán `POST /api/finance/payments`
  - Verify invoice status cập nhật
  - Xem tại `/dashboard/finance/payments`
- [ ] **Budget management (login KTKH R03):**
  - Tạo budget `POST /api/finance/budgets`
  - Xem budget variance `GET /api/finance/budgets/variance`
  - Xem tại `/dashboard/finance/budgets`
- [ ] **Cashflow (login KT R08):**
  - Tạo cashflow `POST /api/finance/cashflow`
  - Xem tại `/dashboard/finance/cashflow`
- [ ] **Cashflow entries (login KT R08):**
  - Tạo cashflow entry `POST /api/finance/cashflow-entries`
  - Xem tại `/dashboard/finance/cashflow-entries`
- [ ] **Settlement (login KT R08):**
  - Xem tại `/dashboard/finance/settlement` — verify page renders
- [ ] **Finance dashboard:**
  - Truy cập `/dashboard/finance` — verify widgets hiển thị
- [ ] **Negative tests:**
  - Tạo payment vượt quá invoice amount → error
  - Tạo invoice thiếu required fields → validation error
  - Login KHO (R05) → POST /api/finance/invoices → 403

### Verification
```bash
npx playwright test e2e/finance.spec.ts --reporter=list
```

### Exit Criteria
- Full invoice → payment flow
- Budget creation + variance analysis
- Settlement page accessible
- Cashflow + cashflow-entries đều hoạt động

---

## Step 8: QC Module Tests

**Branch:** `e2e/step-8-qc`  
**Model tier:** default  
**Depends on:** Step 1  
**Files:** `e2e/qc.spec.ts`

### Context Brief
Test module Quản lý Chất lượng. Login QC (R09) cho tất cả QC operations. Tham chiếu pages: `/dashboard/qc/*`.

### Tasks
- [ ] **Inspection (login QC R09):**
  - Tạo inspection `POST /api/qc`
  - Thêm inspection items
  - Xem chi tiết tại `/dashboard/qc/[id]`
  - Xem danh sách tại `/dashboard/qc/inspections`
- [ ] **ITP — Inspection Test Plan (login QC R09):**
  - Tạo ITP `POST /api/qc/itp`
  - Thêm checkpoints
  - Xem tại `/dashboard/qc/itp`
- [ ] **NCR — Non-Conformance Report (login QC R09):**
  - Tạo NCR `POST /api/qc/ncr`
  - Thêm corrective actions
  - Xem tại `/dashboard/qc/ncr`
- [ ] **Certificates (login QC R09):**
  - Tạo quality certificate `POST /api/qc/certificates`
  - Xem tại `/dashboard/qc/certificates`
- [ ] **Mill certificates (login QC R09):**
  - Tạo mill certificate `POST /api/mill-certificates` (liên kết material + vendor)
  - Xem tại `/dashboard/qc/mill-certificates`
- [ ] **MRB — Material Review Board (login QC R09):**
  - Tạo MRB `POST /api/qc/mrb`
  - Xem tại `/dashboard/qc/mrb`
- [ ] **FAT/SAT (login QC R09):**
  - Xem tại `/dashboard/qc/fat-sat` — verify page renders
- [ ] **QC dashboard:**
  - Truy cập `/dashboard/qc` — verify overview hiển thị
- [ ] **Negative tests:**
  - Tạo NCR thiếu required fields → validation error
  - Login PM (R02) → POST /api/qc → verify permission

### Verification
```bash
npx playwright test e2e/qc.spec.ts --reporter=list
```

### Exit Criteria
- CRUD cho tất cả QC sub-modules bao gồm MRB và FAT/SAT
- NCR → corrective action flow hoạt động

---

## Step 9: Production Module Tests

**Branch:** `e2e/step-9-production`  
**Model tier:** default  
**Depends on:** Step 1  
**Files:** `e2e/production.spec.ts`

### Context Brief
Test module Sản xuất. Login QLSX (R06) cho work orders, TSX (R06b) cho job cards, KHO (R05) cho material issue.

### Tasks
- [ ] **Work Orders (login QLSX R06):**
  - Tạo work order `POST /api/production`
  - Xem danh sách tại `/dashboard/production`
  - Xem chi tiết tại `/dashboard/production/[id]`
  - Transition status `POST /api/production/[id]/transition` (DRAFT → IN_PROGRESS → COMPLETED)
- [ ] **Job Cards (login TSX R06b):**
  - Tạo job card `POST /api/production/job-cards`
  - Xem danh sách tại `/dashboard/production/job-cards`
- [ ] **Workshops (login QLSX R06):**
  - Tạo workshop `POST /api/workshops` với name `E2E-WS-{timestamp}`
  - Xem danh sách tại `/dashboard/production/workshops`
- [ ] **Material Issue for Production (login KHO R05):**
  - Xuất vật tư cho work order `POST /api/production/[id]/issue-material`
  - Verify material issue record
- [ ] **Delivery (login TM R07):**
  - Tạo delivery record `POST /api/delivery`
  - Update delivery status `PATCH /api/delivery`
  - Xem tại `/dashboard/delivery`
- [ ] **Negative tests:**
  - Transition work order sai thứ tự status → error
  - Login TK (R04) → POST /api/production → verify permission

### Verification
```bash
npx playwright test e2e/production.spec.ts --reporter=list
```

### Exit Criteria
- Work order lifecycle (create → transitions → complete)
- Job card creation linked to work order
- Material issue for production

---

## Step 10: Design & Engineering Module Tests

**Branch:** `e2e/step-10-design`  
**Model tier:** default  
**Depends on:** Step 1  
**Files:** `e2e/design.spec.ts`

### Context Brief
Test module Thiết kế. Login TK (R04) cho tất cả design operations. Pages: `/dashboard/design/*`.

### Tasks
- [ ] **BOM — Bill of Materials (login TK R04):**
  - Tạo BOM `POST /api/design/bom`
  - Thêm BOM items (parent-child hierarchy)
  - Xem tại `/dashboard/design/bom`
- [ ] **Drawings (login TK R04):**
  - Tạo drawing `POST /api/drawings`
  - Transition drawing status `POST /api/drawings/[id]/transition`
  - Xem tại `/dashboard/design/drawings`
- [ ] **ECO — Engineering Change Order (login TK R04):**
  - Tạo ECO `POST /api/design/eco`
  - Xem tại `/dashboard/design/eco`
- [ ] **Design hub:**
  - Xem `/dashboard/design` — verify overview
  - Tạo design `POST /api/design`
  - Xem danh sách `GET /api/design`
- [ ] **Negative tests:**
  - Tạo BOM thiếu required fields → validation error
  - Login KHO (R05) → POST /api/design/bom → verify permission

### Verification
```bash
npx playwright test e2e/design.spec.ts --reporter=list
```

### Exit Criteria
- BOM hierarchy (parent-child items) verify đúng
- Drawing status transitions work
- ECO CRUD complete

---

## Step 11: Secondary Modules Tests

**Branch:** `e2e/step-11-secondary`  
**Model tier:** default  
**Depends on:** Step 1  
**Files:** `e2e/secondary-modules.spec.ts`

### Context Brief
Test các module phụ: Safety, Subcontracts, Milestones, Lessons Learned, File Upload, Settings. Mỗi module nhỏ nhưng quan trọng cho coverage.

### Tasks
- [ ] **Safety (login PM R02):**
  - Tạo safety incident `POST /api/safety`
  - Update status `POST /api/safety/[id]/status`
  - Xem tại `/dashboard/safety`
- [ ] **Subcontracts (login PM R02):**
  - Tạo subcontract `POST /api/subcontracts`
  - Xem danh sách tại `/dashboard/subcontracts`
- [ ] **Milestones (login PM R02):**
  - Tạo milestone `POST /api/milestones`
  - Update milestone `PATCH /api/milestones`
  - Xem tại `/dashboard/milestones`
- [ ] **Lessons Learned (login PM R02):**
  - Tạo lesson `POST /api/lessons`
  - Xem tại `/dashboard/lessons`
- [ ] **File Upload (login PM R02):**
  - Upload file `POST /api/upload` (multipart)
  - Get uploaded files `GET /api/upload`
  - Delete file `DELETE /api/upload/[id]`
- [ ] **Settings (login BGD R01):**
  - Xem tại `/dashboard/settings` — verify page renders
- [ ] **Users management (login BGD R01):**
  - Xem danh sách users `GET /api/users`
  - Xem user detail `GET /api/users/[id]`
  - Tạo user `POST /api/users`
  - Update user `PUT /api/users/[id]`
  - Reset password `POST /api/users/[id]/reset-password`
  - Xem tại `/dashboard/users`
- [ ] **Health & Docs (public):**
  - `GET /api/health` → 200
  - `GET /api/docs` → 200
  - Xem `/dashboard/api-docs` — verify Swagger UI renders

### Verification
```bash
npx playwright test e2e/secondary-modules.spec.ts --reporter=list
```

### Exit Criteria
- Tất cả secondary modules có basic CRUD test
- File upload/delete cycle hoạt động
- All pages render without errors

---

## Step 12: Cross-Module Workflow Tests

**Branch:** `e2e/step-12-cross-module`  
**Model tier:** strongest (Opus)  
**Depends on:** Steps 4-11  
**Files:** `e2e/cross-module.spec.ts`

### Context Brief
Test các luồng nghiệp vụ cắt ngang nhiều module — đây là nơi bugs thường xuất hiện nhất. Sử dụng API calls để setup data nhanh, browser verify ở các bước quan trọng.

### Tasks
- [ ] **Procurement → Warehouse → Production flow:**
  1. Login TM (R07) → tạo vendor + material
  2. Login KHO (R05) → tạo Purchase Request → approve
  3. Login TM (R07) → tạo Purchase Order → approve
  4. Login KHO (R05) → nhập kho (GRN) → verify stock qua `GET /api/warehouse/stats`
  5. Login QLSX (R06) → tạo work order
  6. Login KHO (R05) → xuất kho cho work order → verify stock giảm
  7. Login TSX (R06b) → tạo job card → complete
  8. Login TM (R07) → tạo delivery record
- [ ] **Project → Finance flow:**
  1. Login PM (R02) → tạo project
  2. Login KTKH (R03) → tạo budget cho project
  3. Login KT (R08) → tạo invoices liên kết project
  4. Login KT (R08) → ghi nhận payments
  5. Verify budget variance — actual vs planned
  6. Verify cashflow entries tạo tự động
- [ ] **Project → HR → Salary flow:**
  1. Login PM (R02) → tạo project
  2. Login PM → tạo timesheets cho employees
  3. Login KTKH (R03) → ghi nhận attendance
  4. Login QLSX (R06) → tạo piece rate contract
  5. Login TSX (R06b) → ghi nhận piece rate output
  6. Login KTKH (R03) → tính lương → verify salary records
- [ ] **QC rejection → rework flow:**
  1. Login QLSX (R06) → tạo work order
  2. Login QC (R09) → tạo inspection → FAIL
  3. Login QC (R09) → tạo NCR + corrective action
  4. Login QC (R09) → re-inspect → PASS

### Verification
```bash
npx playwright test e2e/cross-module.spec.ts --reporter=list
```

### Exit Criteria
- Tất cả 4 cross-module flows pass
- Data consistency verify ở mỗi bước (stock balances, budget amounts, salary totals)

---

## Step 13: Dashboard, Reports & Navigation Tests

**Branch:** `e2e/step-13-dashboard`  
**Model tier:** default  
**Depends on:** Steps 4-11 (cần data từ các module để dashboard có nội dung)  
**Files:** `e2e/dashboard.spec.ts`, `e2e/reports.spec.ts`

### Context Brief
Test trang dashboard, reports, notifications, và UI navigation cho từng role. Chạy SAU các module tests để dashboard có data hiển thị.

### Tasks
- [ ] **Main dashboard (test với nhiều roles):**
  - Login PM (R02) → `/dashboard` → thấy StatCards (projects, tasks pending)
  - Login KHO (R05) → `/dashboard` → thấy stock summary
  - Login KT (R08) → `/dashboard` → thấy finance summary
  - Login BGD (R01) → `/dashboard` → thấy overview toàn bộ
- [ ] **Role-based dashboard API:**
  - Login PM → `GET /api/dashboard/role` → verify data cho PM
  - Login KHO → `GET /api/dashboard/role` → verify data cho Warehouse
  - Login KT → `GET /api/dashboard/role` → verify data cho Finance
- [ ] **Admin stats (login BGD R01):**
  - `GET /api/admin/stats` → verify response structure
  - `GET /api/admin/config` → verify config
  - `GET /api/admin/audit-logs` → verify audit entries
- [ ] **Reports:**
  - `GET /api/reports` → verify available reports
  - `GET /api/reports/executive` → verify data structure
  - `GET /api/reports/project-profitability` → verify calculations
  - Xem `/dashboard/reports` → UI renders
  - Xem `/dashboard/reports/profitability` → UI renders
- [ ] **Notifications:**
  - Tạo action (e.g., create project) → verify notification xuất hiện cho user liên quan
  - `PUT /api/notifications` → mark as read → verify count giảm
  - Xem `/dashboard/notifications` → verify list
- [ ] **Navigation:**
  - Sidebar collapse/expand hoạt động
  - Click từng menu item → page loads không lỗi
  - Page transitions smooth
- [ ] **Audit log:**
  - Xem `/dashboard/audit-log` → verify entries từ actions trước đó
- [ ] **Cron endpoints (API only):**
  - `GET /api/cron/check` với header `x-cron-secret` → 200
  - `GET /api/cron/deadline-check` với header `x-cron-secret` → 200
  - Không có cron secret → 401/403

### Verification
```bash
npx playwright test e2e/dashboard.spec.ts e2e/reports.spec.ts --reporter=list
```

### Exit Criteria
- Dashboard renders cho tất cả roles không lỗi
- Reports trả về data hợp lệ
- Navigation smooth, không broken links
- Notifications flow hoạt động
- Cron endpoints protected

---

## Invariants (kiểm tra sau MỖI step)

```bash
# 1. Existing tests vẫn pass
npx vitest run

# 2. Existing E2E workflow test vẫn pass
npx playwright test e2e/workflow.spec.ts

# 3. Build thành công
npm run build

# 4. Lint pass
npm run lint
```

---

## Rollback Strategy

Mỗi step là 1 branch + PR riêng biệt. Nếu step nào fail:
- Revert PR
- Existing tests không bị ảnh hưởng
- Không có thay đổi source code (chỉ thêm test files mới trong `e2e/`)

---

## Summary

| Step | Scope | Files | Parallel? | Model |
|------|-------|-------|-----------|-------|
| 1 | Shared helpers, fixtures, config | `helpers.ts`, `fixtures.ts`, `test-data.ts`, `global-*.ts` | — | default |
| 2 | Auth & session | `auth.spec.ts` | ← parallel → | default |
| 3 | RBAC & permissions | `rbac.spec.ts` | ← parallel → | default |
| 4 | Projects & tasks | `projects.spec.ts` | ← parallel → | default |
| 5 | HR module | `hr.spec.ts` | ← parallel → | default |
| 6 | Warehouse & procurement | `warehouse.spec.ts` | ← parallel → | default |
| 7 | Finance module | `finance.spec.ts` | ← parallel → | default |
| 8 | QC module | `qc.spec.ts` | ← parallel → | default |
| 9 | Production module | `production.spec.ts` | ← parallel → | default |
| 10 | Design & engineering | `design.spec.ts` | ← parallel → | default |
| 11 | Secondary modules | `secondary-modules.spec.ts` | ← parallel → | default |
| 12 | Cross-module workflows | `cross-module.spec.ts` | serial (after 4-11) | strongest |
| 13 | Dashboard, reports, navigation | `dashboard.spec.ts`, `reports.spec.ts` | serial (after 4-11) | default |

**Total: 13 steps, ~14 spec files, ~120+ test cases**  
**Parallelism: Steps 2-11 can run in parallel after Step 1**  
**Critical path: Step 1 → Steps 2-11 (parallel) → Steps 12-13 (serial)**
