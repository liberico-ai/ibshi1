# Blueprint: Go-Live Database Cleanup

**Objective:** Xoá toàn bộ dữ liệu nghiệp vụ (business data) trên database PostgreSQL, giữ nguyên dữ liệu hệ thống (users, roles, departments, system config, employees) để chuẩn bị go-live.

**Date:** 2026-04-03  
**Mode:** Direct (SQL script for review before execution)

---

## Phân loại bảng dữ liệu

### GIỮ NGUYÊN (System — 7 bảng)
| # | Table (PostgreSQL) | Prisma Model | Lý do giữ |
|---|---|---|---|
| 1 | `users` | User | Tài khoản đăng nhập |
| 2 | `roles` | Role | Phân quyền |
| 3 | `departments` | Department | Cơ cấu tổ chức |
| 4 | `system_config` | SystemConfig | Cấu hình hệ thống |
| 5 | `employees` | Employee | Dữ liệu nhân sự |
| 6 | `employee_contracts` | EmployeeContract | Hợp đồng lao động |
| 7 | `workshops` | Workshop | Danh mục xưởng sản xuất (master data) |

### XOÁ (Business Data — 46 bảng)

Thứ tự xoá phải tôn trọng foreign key constraints — xoá bảng con trước, bảng cha sau.

#### Lớp 1 — Leaf tables (không có bảng con nào tham chiếu)
| # | Table | Ghi chú |
|---|---|---|
| 1 | `inspection_items` | Con của inspections |
| 2 | `itp_checkpoints` | Con của inspection_test_plans |
| 3 | `ncr_actions` | Con của non_conformance_reports |
| 4 | `drawing_revisions` | Con của drawings |
| 5 | `bom_items` | Con của bill_of_materials (self-ref) |
| 6 | `purchase_request_items` | Con của purchase_requests |
| 7 | `purchase_order_items` | Con của purchase_orders |
| 8 | `payments` | Con của invoices |
| 9 | `monthly_piece_rate_outputs` | Con của piece_rate_contracts |
| 10 | `job_cards` | Con của work_orders |
| 11 | `material_issues` | Con của work_orders, materials |
| 12 | `stock_movements` | Con của materials |
| 13 | `mill_certificates` | Con của materials, vendors |
| 14 | `delivery_records` | Con của projects |
| 15 | `timesheets` | Con của projects, employees |
| 16 | `salary_records` | Con của employees |
| 17 | `attendance` | Con của employees |
| 18 | `cashflow_entries` | Con của projects |
| 19 | `change_events` | Con của projects |
| 20 | `safety_incidents` | Con của projects |
| 21 | `lesson_learned` | Con của projects |
| 22 | `file_attachments` | Polymorphic |
| 23 | `notifications` | Tham chiếu user (giữ user, xoá notifications) |
| 24 | `audit_logs` | Tham chiếu user (xoá log cũ cho go-live) |
| 25 | `certificate_registry` | Chứng chỉ vật liệu (business data) |

#### Lớp 2 — Parent tables (sau khi con đã xoá)
| # | Table | Ghi chú |
|---|---|---|
| 26 | `inspections` | Tham chiếu projects |
| 27 | `inspection_test_plans` | Tham chiếu projects |
| 28 | `non_conformance_reports` | Tham chiếu projects |
| 29 | `drawings` | Tham chiếu projects |
| 30 | `bill_of_materials` | Tham chiếu projects |
| 31 | `engineering_change_orders` | Tham chiếu projects |
| 32 | `budgets` | Tham chiếu projects |
| 33 | `invoices` | Tham chiếu projects, vendors |
| 34 | `purchase_orders` | Tham chiếu vendors |
| 35 | `purchase_requests` | Tham chiếu projects |
| 36 | `work_orders` | Tham chiếu projects, workshops |
| 37 | `workflow_tasks` | Tham chiếu projects |
| 38 | `subcontractor_contracts` | Tham chiếu projects, vendors |
| 39 | `piece_rate_contracts` | Tham chiếu projects |

#### Lớp 3 — Hierarchy parents
| # | Table | Ghi chú |
|---|---|---|
| 40 | `wbs_nodes` | Self-referential, tham chiếu projects |
| 41 | `milestones` | Tham chiếu projects |

#### Lớp 4 — Master data (business)
| # | Table | Ghi chú |
|---|---|---|
| 42 | `materials` | Danh mục vật tư |
| 43 | `vendors` | Danh mục nhà cung cấp |
| 44 | `projects` | Dự án |

---

## Các bước thực hiện

### Step 1: Backup database (BẮT BUỘC)
**Mô tả:** Tạo full backup trước khi xoá bất kỳ dữ liệu nào.

```bash
pg_dump -h <HOST> -U <USER> -d <DATABASE> -F c -f backup_before_golive_$(date +%Y%m%d_%H%M%S).dump
```

**Exit criteria:** File backup tồn tại và có kích thước > 0.

---

### Step 2: Tạo SQL cleanup script
**Mô tả:** Tạo file `scripts/golive-cleanup.sql` với nội dung xoá theo đúng thứ tự FK.

Script sẽ:
1. Bắt đầu trong một transaction (`BEGIN`)
2. Xoá từ lớp 1 → lớp 4 theo thứ tự trên
3. Reset sequences (auto-increment) về 1 cho các bảng đã xoá
4. Kết thúc với `COMMIT` (hoặc `ROLLBACK` nếu có lỗi)

**Exit criteria:** File SQL tồn tại, cú pháp hợp lệ.

---

### Step 3: Review & xác nhận với user
**Mô tả:** Trình bày script cho user review trước khi chạy.

Các câu hỏi cần xác nhận:
- ✅ Có muốn giữ `vendors` và `materials` (master data) không?
- ✅ Có muốn giữ `attendance` và `salary_records` (HR data) không?
- ✅ Có muốn xoá `audit_logs` và `notifications` không?
- ✅ Có muốn giữ `workshops` không?
- ✅ Database connection string để chạy script?

---

### Step 4: Chạy script
**Mô tả:** Thực thi SQL script trên database.

```bash
psql -h <HOST> -U <USER> -d <DATABASE> -f scripts/golive-cleanup.sql
```

**Exit criteria:** Tất cả TRUNCATE thành công, không có lỗi FK violation.

---

### Step 5: Verify
**Mô tả:** Kiểm tra kết quả.

```sql
-- Đếm records còn lại trong các bảng system (phải > 0)
SELECT 'users' as tbl, COUNT(*) FROM users
UNION ALL SELECT 'roles', COUNT(*) FROM roles
UNION ALL SELECT 'departments', COUNT(*) FROM departments
UNION ALL SELECT 'employees', COUNT(*) FROM employees
UNION ALL SELECT 'system_config', COUNT(*) FROM system_config;

-- Đếm records trong các bảng business (phải = 0)
SELECT 'projects' as tbl, COUNT(*) FROM projects
UNION ALL SELECT 'work_orders', COUNT(*) FROM work_orders
UNION ALL SELECT 'invoices', COUNT(*) FROM invoices
UNION ALL SELECT 'materials', COUNT(*) FROM materials;
```

**Exit criteria:** Bảng system có data, bảng business = 0 records.

---

## Lưu ý quan trọng

1. **PHẢI backup trước khi chạy** — không có cách nào khôi phục nếu không có backup
2. Sử dụng `TRUNCATE ... CASCADE` thay vì `DELETE` để nhanh hơn và reset sequences
3. Toàn bộ script chạy trong **transaction** — nếu có lỗi sẽ rollback hết
4. **Không xoá Prisma migrations** (`_prisma_migrations`) — giữ nguyên schema history
