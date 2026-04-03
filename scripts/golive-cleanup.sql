-- ============================================================
-- IBS ERP — Go-Live Database Cleanup Script
-- Date: 2026-04-03
-- Purpose: Xoa toan bo du lieu nghiep vu, giu nguyen du lieu he thong
-- ============================================================
--
-- GIU NGUYEN (khong xoa):
--   users, roles, departments, system_config
--   employees, employee_contracts, attendance, salary_records
--   audit_logs, notifications
--   _prisma_migrations
--
-- XOA: Tat ca bang nghiep vu (41 bang)
--
-- QUAN TRONG: Chay pg_dump TRUOC KHI thuc thi script nay!
-- pg_dump -h <HOST> -U <USER> -d <DB> -F c -f backup_before_golive.dump
-- ============================================================

BEGIN;

-- ============================================================
-- TRUNCATE tat ca bang nghiep vu trong 1 lenh duy nhat
-- PostgreSQL se tu dong xu ly FK dependencies
-- ============================================================

TRUNCATE TABLE
  -- Leaf tables
  inspection_items,
  itp_checkpoints,
  ncr_actions,
  drawing_revisions,
  bom_items,
  purchase_request_items,
  purchase_order_items,
  payments,
  monthly_piece_rate_outputs,
  job_cards,
  material_issues,
  stock_movements,
  mill_certificates,
  delivery_records,
  timesheets,
  cashflow_entries,
  change_events,
  safety_incidents,
  lesson_learned,
  file_attachments,
  certificate_registry,
  -- Parent tables
  inspections,
  inspection_test_plans,
  non_conformance_reports,
  drawings,
  bill_of_materials,
  engineering_change_orders,
  budgets,
  invoices,
  purchase_orders,
  purchase_requests,
  work_orders,
  workflow_tasks,
  subcontractor_contracts,
  piece_rate_contracts,
  -- Hierarchy parents
  wbs_nodes,
  milestones,
  -- Master data
  materials,
  vendors,
  workshops,
  projects
RESTART IDENTITY;

-- ============================================================
-- KIEM TRA KET QUA
-- ============================================================

-- Bang he thong (phai con du lieu)
SELECT 'SYSTEM TABLES (phai > 0):' AS check_type;
SELECT 'users' AS table_name, COUNT(*) AS row_count FROM users
UNION ALL SELECT 'roles', COUNT(*) FROM roles
UNION ALL SELECT 'departments', COUNT(*) FROM departments
UNION ALL SELECT 'employees', COUNT(*) FROM employees
UNION ALL SELECT 'employee_contracts', COUNT(*) FROM employee_contracts
UNION ALL SELECT 'attendance', COUNT(*) FROM attendance
UNION ALL SELECT 'salary_records', COUNT(*) FROM salary_records
UNION ALL SELECT 'system_config', COUNT(*) FROM system_config
UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications;

-- Bang nghiep vu (phai = 0)
SELECT 'BUSINESS TABLES (phai = 0):' AS check_type;
SELECT 'projects' AS table_name, COUNT(*) AS row_count FROM projects
UNION ALL SELECT 'work_orders', COUNT(*) FROM work_orders
UNION ALL SELECT 'invoices', COUNT(*) FROM invoices
UNION ALL SELECT 'materials', COUNT(*) FROM materials
UNION ALL SELECT 'vendors', COUNT(*) FROM vendors
UNION ALL SELECT 'purchase_orders', COUNT(*) FROM purchase_orders;

COMMIT;

-- ============================================================
-- NEU CO LOI: Transaction se tu dong ROLLBACK, khong mat du lieu
-- De chay thu (dry run), thay COMMIT bang ROLLBACK
-- ============================================================
