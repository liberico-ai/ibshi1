# PRODUCTION SURFACE MAP — IBS ERP

> Snapshot: 2026-06-27 · Commit: `099beaf` (main)
> Read-only audit — không ghi/sửa DB.

---

## 1. MỌI ROUTE / MÀN HÌNH ĐANG SỐNG

### 1A. Màn hình HIỆN (visible in menu)

| # | Đường dẫn | Menu key | Nhóm | Mục đích | Hệ |
|---|-----------|----------|------|----------|-----|
| 1 | `/dashboard` | dashboard | overview | Bảng điều khiển cá nhân (task assigned, overdue, stats) | Động |
| 2 | `/dashboard/work` | work | overview | Inbox công việc (giao/nhận/theo dõi) | Động |
| 3 | `/dashboard/work/team` | work-team | overview | Phòng của tôi — danh sách thành viên & việc phòng | Động |
| 4 | `/dashboard/work/meetings` | work-meetings | overview | Lịch họp — tạo, mời, xác nhận, biên bản | Động |
| 5 | `/dashboard/notifications` | notifications | overview | Thông báo hệ thống (task, deadline, review) | Chung |
| 6 | `/dashboard/work/overview` | work-overview | management | Tổng quan dự án (chart, heatmap, progress) | Động |
| 7 | `/dashboard/work/briefing` | work-briefing | management | Giao ban tuần (snapshot, agenda, action items) | Động |
| 8 | `/dashboard/work/performance` | work-perf | management | Hiệu suất & KPI theo phòng/cá nhân | Động |
| 9 | `/dashboard/projects` | projects | project | Danh sách & chi tiết dự án | Chung |
| 10 | `/dashboard/milestones` | milestones | project | Cột mốc dự án | Chung |
| 11 | `/dashboard/subcontracts` | subcontracts | project | Hợp đồng thầu phụ | Chung |
| 12 | `/dashboard/lessons` | lessons | project | Bài học kinh nghiệm | Chung |
| 13 | `/dashboard/safety` | safety | project | An toàn lao động | Chung |
| 14 | `/dashboard/warehouse` | warehouse | warehouse | Tổng kho (tồn kho, cảnh báo) | Vận hành |
| 15 | `/dashboard/warehouse/material-codes` | material-codes | warehouse | Quản lý mã vật tư (CRUD, alias, merge) | Vận hành |
| 16 | `/dashboard/vendors` | vendors | warehouse | Nhà cung cấp | Vận hành |
| 17 | `/dashboard/hr` | hr | hr | Dashboard nhân sự | Vận hành |
| 18 | `/dashboard/hr/employees` | employees | hr | Danh sách nhân viên | Vận hành |
| 19 | `/dashboard/hr/salary` | salary | hr | Bảng lương | Vận hành |
| 20 | `/dashboard/hr/timesheets` | timesheets | hr | Chấm công | Vận hành |
| 21 | `/dashboard/hr/attendance` | attendance | hr | Điểm danh | Vận hành |
| 22 | `/dashboard/hr/departments` | departments | hr | Phòng ban (cơ cấu tổ chức) | Vận hành |
| 23 | `/dashboard/hr/contracts` | contracts | hr | Hợp đồng lao động | Vận hành |
| 24 | `/dashboard/hr/piece-rate` | piece-rate | hr | Hợp đồng khoán (sản xuất) | Vận hành |
| 25 | `/dashboard/hr/piece-rate-output` | piece-rate-output | hr | Khối lượng khoán tháng | Vận hành |
| 26 | `/dashboard/finance` | finance | finance | Dashboard tài chính | Vận hành |
| 27 | `/dashboard/finance/invoices` | invoices | finance | Hóa đơn | Vận hành |
| 28 | `/dashboard/finance/cashflow` | cashflow | finance | Dòng tiền (kế hoạch vs thực tế) | Vận hành |
| 29 | `/dashboard/finance/cashflow-entries` | cashflow-entries | finance | Bút toán dòng tiền | Vận hành |
| 30 | `/dashboard/finance/payments` | payments | finance | Thanh toán (+ drawdown HTKD) | Vận hành |
| 31 | `/dashboard/finance/budgets` | budgets | finance | Ngân sách dự án | Vận hành |
| 32 | `/dashboard/finance/settlement` | settlement | finance | Quyết toán dự án | Vận hành |
| 33 | `/dashboard/reports` | reports | reports | Báo cáo tổng hợp | Chung |
| 34 | `/dashboard/reports/profitability` | — | reports | Lãi lỗ theo dự án (sub-page) | Chung |
| 35 | `/dashboard/audit-log` | audit-log | reports | Nhật ký hệ thống | System |
| 36 | `/dashboard/admin/error-logs` | error-logs | reports | Error logs (server) | System |
| 37 | `/dashboard/users` | users | system | Quản lý người dùng | System |
| 38 | `/dashboard/admin` | admin | system | Admin dashboard (stats, config, telegram) | System |
| 39 | `/dashboard/work/templates` | work-templates | system | Quy trình & Template (workflow builder) | Động |
| 40 | `/dashboard/settings` | settings | system | Cài đặt cá nhân | Chung |

**Sub-pages (không có menu riêng, truy cập qua link):**

| Đường dẫn | Mục đích |
|-----------|----------|
| `/dashboard/projects/[id]` | Chi tiết dự án |
| `/dashboard/work/[id]` | Chi tiết công việc (task động) |
| `/dashboard/work/create` | Tạo công việc mới (3-step stepper) |
| `/dashboard/work/meetings/[id]` | Chi tiết cuộc họp + biên bản |
| `/dashboard/warehouse/[id]` | Chi tiết vật tư trong kho |
| `/dashboard/production/[id]` | Chi tiết lệnh sản xuất (work order) |
| `/dashboard/qc/[id]` | Chi tiết kiểm tra |

### 1B. Màn hình ẨN (trong HIDDEN_MENU_KEYS — route vẫn tồn tại, menu bị giấu)

Đây là các module gắn luồng 36 bước cũ (WorkflowTask). Menu ẩn để chuyển sang hệ động, nhưng route vẫn hoạt động nếu truy cập URL trực tiếp.

| Nhóm | Các key ẩn | Route tương ứng |
|------|-----------|-----------------|
| Design | `design`, `bom`, `drawings`, `eco` | `/dashboard/design/*` (4 trang) |
| Warehouse ops | `procurement`, `purchase-requests`, `purchase-orders`, `grn`, `material-issue`, `movements` | `/dashboard/warehouse/*` (6 trang) |
| Production | `production`, `jobcards`, `workshops`, `delivery` | `/dashboard/production/*` + `/dashboard/delivery` (4 trang) |
| QC | `qc`, `inspections`, `itp`, `ncr`, `certificates`, `mill-certs`, `fat-sat`, `mrb` | `/dashboard/qc/*` (8 trang) |

**Tổng: 22 trang ẩn** — chưa xóa code, chưa redirect. Truy cập trực tiếp URL vẫn render.

### 1C. Trang có route nhưng KHÔNG CÓ trong menu

| Đường dẫn | Ghi chú |
|-----------|---------|
| `/dashboard/tasks` | Luồng 36 bước cũ — menu item bị comment out |
| `/dashboard/tasks/[id]` | Chi tiết WorkflowTask (~5420 dòng) — vẫn dùng cho dự án cũ |
| `/dashboard/api-docs` | Swagger/OpenAPI viewer |

---

## 2. MENU THEO ROLE (10 phòng)

Ma trận: nhóm menu × role code. `✓` = hiện, `—` = ẩn.

> Lưu ý: Các nhóm `design`, `warehouse` (ops), `production`, `qc` bị HIDDEN_MENU_KEYS ẩn toàn bộ cho MỌI role. Bảng dưới chỉ hiện menu thật sự visible.

### Nhóm Overview (mọi role)

| Menu | R01 | R02 | R02a | R03 | R03a | R04 | R04a | R05 | R05a | R06 | R06a | R06b | R07 | R07a | R08 | R08a | R09 | R09a | R10 | R13 |
|------|-----|-----|------|-----|------|-----|------|-----|------|-----|------|------|-----|------|-----|------|-----|------|-----|-----|
| Bảng điều khiển | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Công việc | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Phòng của tôi | ✓ | ✓ | — | ✓ | — | ✓ | — | — | — | ✓ | — | — | — | — | ✓ | — | ✓ | — | ✓ | ✓ |
| Lịch họp | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Thông báo | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

### Nhóm Management

| Menu | R01 | R02 | R02a | R03 | R03a | R04 | R05 | R06 | R07 | R08 | R09 | R10 | R13 |
|------|-----|-----|------|-----|------|-----|-----|-----|-----|-----|-----|-----|-----|
| Tổng quan dự án | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — | — | — | — |
| Giao ban tuần | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Hiệu suất & KPI | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — | — | ✓ | — |

### Nhóm Project

| Menu | R01 | R02 | R02a | R03 | R03a | R04 | R04a | R06 | R06a | R07 | R07a | R09 | R09a |
|------|-----|-----|------|-----|------|-----|------|-----|------|-----|------|-----|------|
| Dự án | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — |
| Cột mốc | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — | — | — | — |
| Thầu phụ | ✓ | ✓ | ✓ | — | — | — | — | — | — | ✓ | ✓ | — | — |
| Bài học KN | ✓ | ✓ | ✓ | — | — | — | — | — | — | — | — | — | — |
| An toàn | ✓ | ✓ | ✓ | — | — | — | — | ✓ | ✓ | — | — | ✓ | ✓ |

### Nhóm Warehouse (chỉ 2 mục visible — phần ops đã ẩn)

| Menu | R01 | R03 | R03a | R05 | R05a | R07 | R07a | R10 |
|------|-----|-----|------|-----|------|-----|------|-----|
| Kho | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — |
| Mã vật tư | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
| NCC (vendors) | ✓ | — | — | — | — | ✓ | ✓ | — |

### Nhóm HR

| Menu | R01 | R02 | R02a | R06 | R06a | R06b |
|------|-----|-----|------|-----|------|------|
| Nhân sự (dashboard) | ✓ | ✓ | ✓ | — | — | — |
| Nhân viên | ✓ | ✓ | ✓ | — | — | — |
| Bảng lương | ✓ | ✓ | ✓ | — | — | — |
| Chấm công | ✓ | ✓ | ✓ | — | — | — |
| Điểm danh | ✓ | ✓ | ✓ | — | — | — |
| Phòng ban | ✓ | ✓ | ✓ | — | — | — |
| HĐLĐ | ✓ | ✓ | ✓ | — | — | — |
| HĐ khoán | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| KL khoán | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

### Nhóm Finance

| Menu | R01 | R02 | R02a | R03 | R03a | R07 | R07a | R08 | R08a |
|------|-----|-----|------|-----|------|-----|------|-----|------|
| Tài chính | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Hóa đơn | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Dòng tiền | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | ✓ | ✓ |
| Bút toán | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | ✓ | ✓ |
| Thanh toán | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | ✓ | ✓ |
| Ngân sách | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | ✓ | ✓ |
| Quyết toán | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | ✓ | ✓ |

### Nhóm Reports + System

| Menu | R01 | R02 | R02a | R03 | R03a | R06 | R06a | R08 | R08a | R09 | R09a | R10 | R13 |
|------|-----|-----|------|-----|------|-----|------|-----|------|-----|------|-----|-----|
| Báo cáo | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Nhật ký | ✓ | — | — | — | — | — | — | — | — | — | — | ✓ | — |
| Error Logs | ✓ | — | — | — | — | — | — | — | — | — | — | ✓ | — |
| Người dùng | ✓ | — | — | — | — | — | — | — | — | — | — | ✓ | — |
| Admin | ✓ | — | — | — | — | — | — | — | — | — | — | ✓ | — |
| Templates | ✓ | ✓ | — | — | — | — | — | — | — | — | — | ✓ | — |
| Cài đặt | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

### Tóm tắt theo phòng

| Phòng | Roles | Nhóm menu visible |
|-------|-------|-------------------|
| Ban Giám đốc | R01 | Tất cả (11 nhóm) |
| CNTT & Dữ liệu | R10 | overview, management, project, warehouse, system, reports |
| Quản lý Dự án | R02, R02a | overview, management, project, design*, warehouse, hr, finance, reports |
| Kinh tế Kế hoạch | R03, R03a | overview, management, project, finance, warehouse, reports |
| Phòng Kỹ thuật | R04, R04a | overview, design*, project |
| Thương mại | R07, R07a | overview, warehouse, finance |
| Sản xuất | R06, R06a, R06b | overview, hr, reports |
| Tài chính KT & Kho | R08/R08a + R05/R05a | overview, finance/warehouse, reports |
| QA/QC | R09, R09a | overview, reports |
| Thiết bị & Cơ giới | R13 | overview, reports |

*Design menu bị ẩn bởi HIDDEN_MENU_KEYS — nhóm `design` chỉ visible nếu bỏ ẩn.

---

## 3. ENTITY + STATUS

### 3A. Thực thể chính + chuỗi status

| Model | Table | Default | Status values | Ghi chú |
|-------|-------|---------|---------------|---------|
| **Task** | tasks | OPEN | OPEN → IN_PROGRESS → DONE / RETURNED / CANCELLED | Hệ động — core entity |
| **WorkflowTask** | workflow_tasks | PENDING | PENDING → IN_PROGRESS → COMPLETED / REJECTED | Luồng 36 bước cũ (legacy) |
| **Project** | projects | ACTIVE | ACTIVE / ON_HOLD / COMPLETED / CANCELLED | |
| **Meeting** | meetings | SCHEDULED | SCHEDULED → DONE / CANCELLED | |
| **MeetingInvite** | meeting_invites | INVITED | INVITED → ACCEPTED / DECLINED | |
| **PurchaseRequest** | purchase_requests | DRAFT | DRAFT → SUBMITTED → APPROVED / REJECTED | |
| **PurchaseOrder** | purchase_orders | DRAFT | DRAFT → APPROVED → RECEIVED / PARTIAL / CANCELLED | |
| **Material** | materials | ACTIVE | ACTIVE / ARCHIVE / OBSOLETE | |
| **WorkOrder** | work_orders | PENDING_MATERIAL | PENDING_MATERIAL → READY_TO_CUT → IN_PROGRESS → PENDING_QC → COMPLETED | |
| **JobCard** | job_cards | OPEN | OPEN → IN_PROGRESS → COMPLETED | |
| **Inspection** | inspections | PENDING | PENDING → IN_PROGRESS → COMPLETED → APPROVED | |
| **InspectionTestPlan** | inspection_test_plans | DRAFT | DRAFT → APPROVED | |
| **NonConformanceReport** | non_conformance_reports | OPEN | OPEN → IN_PROGRESS → CLOSED | |
| **NcrAction** | ncr_actions | OPEN | OPEN → IN_PROGRESS → CLOSED | |
| **Drawing** | drawings | IFR | IFR → IFA → IFC → AS_BUILT | |
| **BillOfMaterial** | bills_of_material | DRAFT | DRAFT → APPROVED | |
| **EngineeringChangeOrder** | engineering_change_orders | DRAFT | DRAFT → SUBMITTED → APPROVED / REJECTED | |
| **Invoice** | invoices | DRAFT | DRAFT → SUBMITTED → APPROVED → PAID | |
| **DeliveryRecord** | delivery_records | PACKING | PACKING → SHIPPED → DELIVERED | |
| **CashflowEntry** | cashflow_entries | RECORDED | RECORDED | Single status |
| **SafetyIncident** | safety_incidents | OPEN | OPEN → INVESTIGATING → CLOSED | |
| **Timesheet** | timesheets | DRAFT | DRAFT → SUBMITTED → APPROVED | |
| **SalaryRecord** | salary_records | DRAFT | DRAFT → APPROVED → PAID | |
| **Milestone** | milestones | PENDING | PENDING → IN_PROGRESS → COMPLETED | |
| **SubcontractorContract** | subcontractor_contracts | ACTIVE | ACTIVE → COMPLETED / TERMINATED | |
| **Employee** | employees | ACTIVE | ACTIVE / INACTIVE / TERMINATED | |
| **Attendance** | attendance | PRESENT | PRESENT / ABSENT / LATE / LEAVE | |

### 3B. Thực thể phụ trợ (không có status workflow)

| Model | Table | Mục đích |
|-------|-------|----------|
| User | users | Tài khoản đăng nhập |
| Department | departments | Cơ cấu phòng ban (hỗ trợ parentId cho tổ SX) |
| Role | roles | Vai trò RBAC |
| FileAttachment | file_attachments | File đính kèm (entityType + entityId) |
| BriefingSnapshot | briefing_snapshots | Bản chụp giao ban tuần |
| Notification | notifications | Thông báo in-app |
| AuditLog | audit_logs | Nhật ký thao tác |
| ErrorLog | error_logs | Log lỗi server |
| ChangeEvent | change_events | Sự kiện thay đổi (sync engine) |
| StockMovement | stock_movements | Xuất nhập kho |
| MaterialStock | material_stocks | Tồn kho theo warehouse |
| MaterialGroup | material_groups | Nhóm vật tư |
| MaterialCodeAlias | material_code_aliases | Alias/mapping mã cũ → mã mới |
| MaterialCodeCounter | material_code_counters | Auto-increment mã vật tư |
| ApiClient | api_clients | Khóa API external |
| SystemConfig | system_configs | Cấu hình hệ thống (key-value) |
| TaskAssignee | task_assignees | Gán người → Task động |
| TaskDocRequirement | task_doc_requirements | Yêu cầu tài liệu (MUST_READ / MUST_RETURN) |
| TaskDocAck | task_doc_acks | Xác nhận đã đọc tài liệu |
| TaskHistory | task_history | Lịch sử task (CREATED/ASSIGNED/COMPLETED/...) |
| WbsNode | wbs_nodes | Work Breakdown Structure |
| LessonLearned | lessons_learned | Bài học kinh nghiệm |
| Vendor | vendors | Nhà cung cấp |
| PurchaseRequestItem | purchase_request_items | Dòng PR |
| PurchaseOrderItem | purchase_order_items | Dòng PO |
| MillCertificate | mill_certificates | Chứng chỉ vật liệu |
| Workshop | workshops | Phân xưởng |
| MaterialIssue | material_issues | Cấp phát vật tư |
| InspectionItem | inspection_items | Dòng kiểm tra |
| ITPCheckpoint | itp_checkpoints | Điểm kiểm tra trong ITP |
| CertificateRegistry | certificate_registries | Sổ chứng chỉ |
| DrawingRevision | drawing_revisions | Lần sửa bản vẽ |
| BomItem | bom_items | Dòng BOM |
| EmployeeContract | employee_contracts | Hợp đồng lao động |
| Budget | budgets | Ngân sách dự án |
| Payment | payments | Lịch thanh toán |
| PieceRateContract | piece_rate_contracts | Hợp đồng khoán SX |
| MonthlyPieceRateOutput | monthly_piece_rate_outputs | KL khoán tháng |
| DailyProductionLog | daily_production_logs | Nhật ký SX hàng ngày |
| WeeklyAcceptanceLog | weekly_acceptance_logs | Nghiệm thu tuần |
| CreditFacility | credit_facilities | Hạn mức tín dụng |
| LoanContract | loan_contracts | Hợp đồng vay |
| LoanDrawdown | loan_drawdowns | Giải ngân vay |
| ProjectFinancePlan | project_finance_plans | Kế hoạch tài chính DA |
| MisaSyncLog | misa_sync_logs | Log đồng bộ MISA kế toán |

---

## 4. FLOW CHÍNH

### 4A. Flow Mua hàng (đang production)

```
PR (Đề xuất mua) → Khớp tồn kho (BomPrUploadUI) → Báo giá NCC (SupplierQuoteUI)
→ Tạo PO → Nhận hàng (GRN) → Xuất kho (MaterialIssue)
```

- **PR**: tạo từ biểu mẫu PR trong Task động hoặc trang PR cũ. Gắn `needToBuyQty` từ stock matching.
- **Báo giá NCC**: MaterialMatrix so sánh giá theo `needToBuyQty`. Chọn NCC → tạo PO.
- **PO**: tạo từ `POST /api/work/tasks/[id]/create-po` (idempotent). `materialId = null` supported.
- **GRN**: nhận hàng theo PO, cập nhật tồn kho, tạo StockMovement.
- **Cấp phát**: MaterialIssue xuất từ kho → công trường. Trừ tồn.

### 4B. Flow Công việc Động (Task) — hệ đang chạy

```
Tạo việc (work/create) → Giao assignees → Người nhận làm
→ Hoàn thành / Trả lại / Chuyển tiếp (forward) → DONE
```

- **Tạo**: chọn template (biểu mẫu), upload file, giao cho role/user
- **Template**: ESTIMATE, PR, BBH, WBS, WELD_PAINT, BOM, SUPPLIER_QUOTE — RBAC qua `FORM_EDIT_ROLES`
- **Giao ban**: BriefingSnapshot chụp tuần, agenda items, action items, trạng thái review
- **Họp**: Meeting + MeetingInvite, biên bản (minutesData), file đính kèm
- **Telegram digest**: cron hàng ngày gửi overdue + blocked + lịch họp

### 4C. Flow 36 bước cũ (WorkflowTask) — legacy, đang gỡ

```
P1.1 → P1.1B → [P1.2A, P1.2] → P1.3 → ...
... → P6.1-P6.4 (parallel) → P6.5 (gate)
```

- 36 bước, 6 phase, gắn chặt vào `workflow-constants.ts`
- UI: `tasks/[id]/page.tsx` (~5420 dòng) — switch trên `task.stepCode`
- Menu item `tasks` đã comment out, nhưng route + API vẫn sống
- **Kế hoạch**: giữ nguyên cho dự án đã chạy, không tạo mới. Dần chuyển sang Task động.

### 4D. Flow Sản xuất (ẩn menu, route sống)

```
WorkOrder (PENDING_MATERIAL → READY_TO_CUT → IN_PROGRESS → PENDING_QC → COMPLETED)
    ↳ JobCard (phiếu công việc cho tổ SX)
    ↳ MaterialIssue (cấp phát vật tư)
    ↳ Inspection (QC kiểm tra)
```

### 4E. Flow Tài chính

```
Invoice (DRAFT → SUBMITTED → APPROVED → PAID)
    ↳ Payment (thanh toán theo đợt)
    ↳ CashflowEntry (bút toán)
    ↳ Budget (ngân sách dự án)
    ↳ Settlement (quyết toán)
    ↳ LoanDrawdown → MISA sync
```

---

## 5. GAP — Thiếu / Lệch

### 5A. Role không có UI riêng

| Role | Phòng | Menu visible | Vấn đề |
|------|-------|-------------|--------|
| R05, R05a | Kho | warehouse (2 mục) | Các trang ops (GRN, PO, movements, material-issue) bị HIDDEN. Kho chỉ xem tồn + mã VT. |
| R06b | CN Sản xuất (77 user) | overview + production* + hr | Production bị HIDDEN → chỉ thấy dashboard + KL khoán. |
| R07, R07a | Thương mại | overview + warehouse + finance | PO, PR bị HIDDEN → TM chỉ xem tồn kho + NCC + tài chính. |
| R09, R09a | QC | overview + reports | Toàn bộ nhóm QC bị HIDDEN → QC không có UI chuyên môn. |
| R13 | TB & Cơ giới | overview + reports | Không có module quản lý thiết bị. |

### 5B. Module ẩn cần quyết định

| Module | Trang | Lý do ẩn | Khuyến nghị |
|--------|-------|----------|-------------|
| Design (4 trang) | BOM, Drawing, ECO, Design dashboard | Chuyển sang biểu mẫu BOM/WELD_PAINT trong Task động | Bật lại nếu TK cần xem BOM tổng / bản vẽ ngoài task |
| Procurement (6 trang) | PR, PO, GRN, movements, material-issue, procurement | Flow mua hàng chạy qua Task → SupplierQuoteUI | Bật GRN + PO cho R05/R07 nếu muốn xem/duyệt ngoài task |
| Production (4 trang) | WorkOrder, JobCard, Workshop, Delivery | Chưa tích hợp Task động | Bật khi SX bắt đầu dùng ERP |
| QC (8 trang) | Inspection, ITP, NCR, Cert, MillCert, FAT/SAT, MRB | Chưa tích hợp Task động | Bật khi QC bắt đầu dùng ERP |

### 5C. Lệch nghiệp vụ

| Vấn đề | Chi tiết |
|--------|----------|
| `timestamp without time zone` | Tất cả DateTime trong schema dùng `timestamp without time zone`. Prisma coi là UTC khi đọc, nhưng giá trị raw phụ thuộc TZ lúc ghi. Nên migrate sang `timestamptz` hoặc đảm bảo server luôn chạy UTC. |
| WorkflowTask + Task song song | 2 hệ task tồn tại cùng lúc. Dự án cũ dùng WorkflowTask, dự án mới dùng Task. Không có bridge/migration path. |
| 22 trang ẩn vẫn có route | URL trực tiếp vẫn truy cập được. Không có redirect hay guard "module disabled". |
| `profitability` sub-page không có menu key | `/dashboard/reports/profitability` chỉ truy cập qua link trong reports page |
| R11 (HCNS) 13 user inactive | Phòng HCNS đã bỏ, user dept=null. Không có cleanup script. |
| R12 (EPC) 0 user | Role tồn tại trong DB nhưng 0 user, không xuất hiện trong bất kỳ config nào. |

### 5D. API routes không có UI tương ứng

| Route | Mục đích | UI |
|-------|----------|-----|
| `/api/external/v1/*` | API tích hợp bên ngoài (Sale) | Không — dùng bởi hệ thống khác |
| `/api/docs` | OpenAPI spec | Có `/dashboard/api-docs` |
| `/api/cron/*` | Cron jobs (digest, check, acceptance) | Gọi bởi cron, không UI |
| `/api/telegram/*` | Webhook + setup bot | Admin config |
| `/api/work/suggest-route` | Gợi ý route cho task | Gọi nội bộ từ work UI |

---

## Thống kê tổng

| Metric | Số |
|--------|----|
| Trang dashboard (page.tsx) | 72 |
| Trang visible trong menu | 40 |
| Trang ẩn (HIDDEN_MENU_KEYS) | 22 |
| Trang không có menu | 10 |
| API routes (route.ts) | 152 |
| Prisma models | 52 |
| Models có status workflow | 26 |
| Roles trong RBAC | 16 (R01–R13, trừ R11/R12 inactive) |
| Phòng ban hoạt động | 10 |
| Biểu mẫu (FORM_EDIT_ROLES) | 7 |
