-- AlterTable
ALTER TABLE "material_issues" ADD COLUMN     "heat_number" TEXT;

-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "grade" TEXT,
ADD COLUMN     "name_en" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "reserved_stock" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "specification" TEXT;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "heat_number" TEXT,
ADD COLUMN     "lot_number" TEXT,
ADD COLUMN     "po_item_id" TEXT;

-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "completed_qty" DECIMAL(65,30) DEFAULT 0,
ADD COLUMN     "quantity" DECIMAL(65,30),
ADD COLUMN     "wo_type" TEXT NOT NULL DEFAULT 'INTERNAL',
ADD COLUMN     "workshop_id" TEXT,
ALTER COLUMN "status" SET DEFAULT 'PENDING_MATERIAL';

-- CreateTable
CREATE TABLE "milestones" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "billing_percent" DECIMAL(65,30) DEFAULT 0,
    "planned_date" TIMESTAMP(3),
    "actual_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontractor_contracts" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "contract_code" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "contract_value" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subcontractor_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_learned" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "root_cause" TEXT,
    "action_taken" TEXT,
    "recommendation" TEXT,
    "submitted_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_learned_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "vendor_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "country" TEXT NOT NULL DEFAULT 'VN',
    "category" TEXT NOT NULL,
    "rating" DECIMAL(65,30) DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requests" (
    "id" TEXT NOT NULL,
    "pr_code" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "urgency" TEXT NOT NULL DEFAULT 'NORMAL',
    "notes" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_request_items" (
    "id" TEXT NOT NULL,
    "pr_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "required_date" TIMESTAMP(3),
    "specification" TEXT,
    "notes" TEXT,

    CONSTRAINT "purchase_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "po_code" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "total_value" DECIMAL(65,30),
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "order_date" TIMESTAMP(3),
    "delivery_date" TIMESTAMP(3),
    "payment_terms" TEXT,
    "created_by" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" TEXT NOT NULL,
    "po_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unit_price" DECIMAL(65,30) NOT NULL,
    "received_qty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mill_certificates" (
    "id" TEXT NOT NULL,
    "cert_number" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "heat_number" TEXT NOT NULL,
    "grade" TEXT,
    "thickness" TEXT,
    "chem_composition" JSONB,
    "mech_properties" JSONB,
    "file_url" TEXT,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mill_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workshops" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT NOT NULL DEFAULT '',
    "capacity" INTEGER NOT NULL DEFAULT 100,

    CONSTRAINT "workshops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_cards" (
    "id" TEXT NOT NULL,
    "job_code" TEXT NOT NULL,
    "work_order_id" TEXT NOT NULL,
    "team_code" TEXT NOT NULL,
    "work_type" TEXT NOT NULL,
    "description" TEXT,
    "planned_qty" DECIMAL(65,30),
    "actual_qty" DECIMAL(65,30),
    "unit" TEXT NOT NULL DEFAULT 'kg',
    "work_date" TIMESTAMP(3) NOT NULL,
    "start_time" TIMESTAMP(3),
    "end_time" TIMESTAMP(3),
    "manpower" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reported_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_test_plans" (
    "id" TEXT NOT NULL,
    "itp_code" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "revision" TEXT NOT NULL DEFAULT 'R0',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_test_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itp_checkpoints" (
    "id" TEXT NOT NULL,
    "itp_id" TEXT NOT NULL,
    "checkpoint_no" INTEGER NOT NULL,
    "activity" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "standard" TEXT,
    "accept_criteria" TEXT,
    "inspection_type" TEXT NOT NULL DEFAULT 'MONITOR',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "inspected_by" TEXT,
    "inspected_at" TIMESTAMP(3),
    "remarks" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "itp_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_conformance_reports" (
    "id" TEXT NOT NULL,
    "ncr_code" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MINOR',
    "description" TEXT NOT NULL,
    "root_cause" TEXT,
    "disposition" TEXT,
    "rework_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "raised_by" TEXT NOT NULL,
    "closed_by" TEXT,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "non_conformance_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ncr_actions" (
    "id" TEXT NOT NULL,
    "ncr_id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "assigned_to" TEXT NOT NULL,
    "due_date" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "evidence" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ncr_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate_registry" (
    "id" TEXT NOT NULL,
    "cert_type" TEXT NOT NULL,
    "cert_number" TEXT NOT NULL,
    "holder_name" TEXT NOT NULL,
    "holder_id" TEXT,
    "issued_by" TEXT NOT NULL,
    "issue_date" TIMESTAMP(3) NOT NULL,
    "expiry_date" TIMESTAMP(3) NOT NULL,
    "standard" TEXT,
    "scope" TEXT,
    "file_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificate_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drawings" (
    "id" TEXT NOT NULL,
    "drawing_code" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "discipline" TEXT NOT NULL,
    "current_rev" TEXT NOT NULL DEFAULT 'R0',
    "status" TEXT NOT NULL DEFAULT 'IFR',
    "drawn_by" TEXT,
    "checked_by" TEXT,
    "approved_by" TEXT,
    "file_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drawings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drawing_revisions" (
    "id" TEXT NOT NULL,
    "drawing_id" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "description" TEXT,
    "issued_date" TIMESTAMP(3) NOT NULL,
    "issued_by" TEXT NOT NULL,
    "file_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drawing_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_of_materials" (
    "id" TEXT NOT NULL,
    "bom_code" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "revision" TEXT NOT NULL DEFAULT 'R0',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "created_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bill_of_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_items" (
    "id" TEXT NOT NULL,
    "bom_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unit" TEXT NOT NULL,
    "remarks" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bom_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engineering_change_orders" (
    "id" TEXT NOT NULL,
    "eco_code" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "change_type" TEXT NOT NULL,
    "impact_cost" DECIMAL(65,30),
    "impact_schedule" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "requested_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "implemented_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engineering_change_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "employee_code" TEXT NOT NULL,
    "user_id" TEXT,
    "full_name" TEXT NOT NULL,
    "date_of_birth" TIMESTAMP(3),
    "gender" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "id_number" TEXT,
    "tax_code" TEXT,
    "social_ins_no" TEXT,
    "bank_account" TEXT,
    "bank_name" TEXT,
    "department_id" TEXT,
    "position" TEXT,
    "employment_type" TEXT NOT NULL DEFAULT 'FULL_TIME',
    "join_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leave_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "dependents" INTEGER NOT NULL DEFAULT 0,
    "distance_km" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_contracts" (
    "id" TEXT NOT NULL,
    "contract_code" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "contract_type" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "base_salary" DECIMAL(65,30) NOT NULL,
    "allowances" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "work_days" INTEGER NOT NULL DEFAULT 26,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "check_in" TIMESTAMP(3),
    "check_out" TIMESTAMP(3),
    "hours_worked" DECIMAL(65,30),
    "overtime" DECIMAL(65,30) DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PRESENT',
    "leave_type" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_records" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "base_salary" DECIMAL(65,30) NOT NULL,
    "work_days" INTEGER NOT NULL,
    "actual_days" DECIMAL(65,30) NOT NULL,
    "overtime_hours" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "overtime_pay" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "allowances" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "bonus" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "social_insurance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "health_insurance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "unemployment_ins" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "taxable_income" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "personal_tax" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "net_salary" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "calculated_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "invoice_code" TEXT NOT NULL,
    "project_id" TEXT,
    "vendor_id" TEXT,
    "type" TEXT NOT NULL,
    "client_name" TEXT,
    "description" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "tax_rate" DECIMAL(65,30) NOT NULL DEFAULT 10,
    "tax_amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "issue_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" TIMESTAMP(3),
    "paid_amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "payment_date" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "planned" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "actual" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "committed" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "forecast" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "month" INTEGER,
    "year" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashflow_entries" (
    "id" TEXT NOT NULL,
    "entry_code" TEXT NOT NULL,
    "project_id" TEXT,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "description" TEXT,
    "entry_date" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECORDED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cashflow_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_incidents" (
    "id" TEXT NOT NULL,
    "incident_code" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "incident_date" TIMESTAMP(3) NOT NULL,
    "severity" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "location" TEXT,
    "description" TEXT NOT NULL,
    "root_cause" TEXT,
    "corrective_action" TEXT,
    "reported_by" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "safety_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheets" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "work_date" TIMESTAMP(3) NOT NULL,
    "hours_regular" DECIMAL(65,30) NOT NULL DEFAULT 8,
    "hours_ot" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "task_description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timesheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_records" (
    "id" TEXT NOT NULL,
    "delivery_code" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "work_order_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PACKING',
    "packing_list" JSONB,
    "shipping_method" TEXT,
    "tracking_no" TEXT,
    "shipped_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "received_by" TEXT,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_attachments" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_size" INTEGER,
    "mime_type" TEXT,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "piece_rate_contracts" (
    "id" TEXT NOT NULL,
    "contract_code" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "team_code" TEXT NOT NULL,
    "work_type" TEXT NOT NULL,
    "unit_price" DECIMAL(65,30) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'kg',
    "contract_value" DECIMAL(65,30),
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "piece_rate_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_piece_rate_outputs" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unit_price" DECIMAL(65,30) NOT NULL,
    "total_amount" DECIMAL(65,30) NOT NULL,
    "verified_by" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monthly_piece_rate_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_events" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "source_step" TEXT NOT NULL,
    "source_model" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "target_model" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "data_before" JSONB,
    "data_after" JSONB,
    "reason" TEXT,
    "triggered_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "milestones_project_id_idx" ON "milestones"("project_id");

-- CreateIndex
CREATE INDEX "milestones_status_idx" ON "milestones"("status");

-- CreateIndex
CREATE UNIQUE INDEX "subcontractor_contracts_contract_code_key" ON "subcontractor_contracts"("contract_code");

-- CreateIndex
CREATE INDEX "subcontractor_contracts_project_id_idx" ON "subcontractor_contracts"("project_id");

-- CreateIndex
CREATE INDEX "subcontractor_contracts_vendor_id_idx" ON "subcontractor_contracts"("vendor_id");

-- CreateIndex
CREATE INDEX "lesson_learned_project_id_idx" ON "lesson_learned"("project_id");

-- CreateIndex
CREATE INDEX "lesson_learned_category_idx" ON "lesson_learned"("category");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_vendor_code_key" ON "vendors"("vendor_code");

-- CreateIndex
CREATE INDEX "vendors_category_idx" ON "vendors"("category");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requests_pr_code_key" ON "purchase_requests"("pr_code");

-- CreateIndex
CREATE INDEX "purchase_requests_project_id_idx" ON "purchase_requests"("project_id");

-- CreateIndex
CREATE INDEX "purchase_requests_status_idx" ON "purchase_requests"("status");

-- CreateIndex
CREATE INDEX "purchase_request_items_pr_id_idx" ON "purchase_request_items"("pr_id");

-- CreateIndex
CREATE INDEX "purchase_request_items_material_id_idx" ON "purchase_request_items"("material_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_po_code_key" ON "purchase_orders"("po_code");

-- CreateIndex
CREATE INDEX "purchase_orders_vendor_id_idx" ON "purchase_orders"("vendor_id");

-- CreateIndex
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders"("status");

-- CreateIndex
CREATE INDEX "purchase_order_items_po_id_idx" ON "purchase_order_items"("po_id");

-- CreateIndex
CREATE INDEX "purchase_order_items_material_id_idx" ON "purchase_order_items"("material_id");

-- CreateIndex
CREATE UNIQUE INDEX "mill_certificates_cert_number_key" ON "mill_certificates"("cert_number");

-- CreateIndex
CREATE INDEX "mill_certificates_material_id_idx" ON "mill_certificates"("material_id");

-- CreateIndex
CREATE INDEX "mill_certificates_heat_number_idx" ON "mill_certificates"("heat_number");

-- CreateIndex
CREATE INDEX "mill_certificates_vendor_id_idx" ON "mill_certificates"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "workshops_code_key" ON "workshops"("code");

-- CreateIndex
CREATE UNIQUE INDEX "job_cards_job_code_key" ON "job_cards"("job_code");

-- CreateIndex
CREATE INDEX "job_cards_work_order_id_idx" ON "job_cards"("work_order_id");

-- CreateIndex
CREATE INDEX "job_cards_team_code_idx" ON "job_cards"("team_code");

-- CreateIndex
CREATE INDEX "job_cards_work_date_idx" ON "job_cards"("work_date");

-- CreateIndex
CREATE INDEX "job_cards_status_idx" ON "job_cards"("status");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_test_plans_itp_code_key" ON "inspection_test_plans"("itp_code");

-- CreateIndex
CREATE INDEX "inspection_test_plans_project_id_idx" ON "inspection_test_plans"("project_id");

-- CreateIndex
CREATE INDEX "itp_checkpoints_itp_id_idx" ON "itp_checkpoints"("itp_id");

-- CreateIndex
CREATE UNIQUE INDEX "non_conformance_reports_ncr_code_key" ON "non_conformance_reports"("ncr_code");

-- CreateIndex
CREATE INDEX "non_conformance_reports_project_id_idx" ON "non_conformance_reports"("project_id");

-- CreateIndex
CREATE INDEX "non_conformance_reports_status_idx" ON "non_conformance_reports"("status");

-- CreateIndex
CREATE INDEX "non_conformance_reports_severity_idx" ON "non_conformance_reports"("severity");

-- CreateIndex
CREATE INDEX "ncr_actions_ncr_id_idx" ON "ncr_actions"("ncr_id");

-- CreateIndex
CREATE INDEX "ncr_actions_assigned_to_idx" ON "ncr_actions"("assigned_to");

-- CreateIndex
CREATE INDEX "certificate_registry_holder_id_idx" ON "certificate_registry"("holder_id");

-- CreateIndex
CREATE INDEX "certificate_registry_expiry_date_idx" ON "certificate_registry"("expiry_date");

-- CreateIndex
CREATE INDEX "certificate_registry_cert_type_idx" ON "certificate_registry"("cert_type");

-- CreateIndex
CREATE UNIQUE INDEX "certificate_registry_cert_type_cert_number_key" ON "certificate_registry"("cert_type", "cert_number");

-- CreateIndex
CREATE UNIQUE INDEX "drawings_drawing_code_key" ON "drawings"("drawing_code");

-- CreateIndex
CREATE INDEX "drawings_project_id_idx" ON "drawings"("project_id");

-- CreateIndex
CREATE INDEX "drawings_status_idx" ON "drawings"("status");

-- CreateIndex
CREATE INDEX "drawing_revisions_drawing_id_idx" ON "drawing_revisions"("drawing_id");

-- CreateIndex
CREATE UNIQUE INDEX "drawing_revisions_drawing_id_revision_key" ON "drawing_revisions"("drawing_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "bill_of_materials_bom_code_key" ON "bill_of_materials"("bom_code");

-- CreateIndex
CREATE INDEX "bill_of_materials_project_id_idx" ON "bill_of_materials"("project_id");

-- CreateIndex
CREATE INDEX "bom_items_bom_id_idx" ON "bom_items"("bom_id");

-- CreateIndex
CREATE INDEX "bom_items_material_id_idx" ON "bom_items"("material_id");

-- CreateIndex
CREATE UNIQUE INDEX "engineering_change_orders_eco_code_key" ON "engineering_change_orders"("eco_code");

-- CreateIndex
CREATE INDEX "engineering_change_orders_project_id_idx" ON "engineering_change_orders"("project_id");

-- CreateIndex
CREATE INDEX "engineering_change_orders_status_idx" ON "engineering_change_orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "employees_employee_code_key" ON "employees"("employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "employees_user_id_key" ON "employees"("user_id");

-- CreateIndex
CREATE INDEX "employees_department_id_idx" ON "employees"("department_id");

-- CreateIndex
CREATE INDEX "employees_status_idx" ON "employees"("status");

-- CreateIndex
CREATE UNIQUE INDEX "employee_contracts_contract_code_key" ON "employee_contracts"("contract_code");

-- CreateIndex
CREATE INDEX "employee_contracts_employee_id_idx" ON "employee_contracts"("employee_id");

-- CreateIndex
CREATE INDEX "attendance_date_idx" ON "attendance"("date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_employee_id_date_key" ON "attendance"("employee_id", "date");

-- CreateIndex
CREATE INDEX "salary_records_month_year_idx" ON "salary_records"("month", "year");

-- CreateIndex
CREATE INDEX "salary_records_status_idx" ON "salary_records"("status");

-- CreateIndex
CREATE UNIQUE INDEX "salary_records_employee_id_month_year_key" ON "salary_records"("employee_id", "month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_code_key" ON "invoices"("invoice_code");

-- CreateIndex
CREATE INDEX "invoices_project_id_idx" ON "invoices"("project_id");

-- CreateIndex
CREATE INDEX "invoices_type_idx" ON "invoices"("type");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "payments_invoice_id_idx" ON "payments"("invoice_id");

-- CreateIndex
CREATE INDEX "budgets_project_id_idx" ON "budgets"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_project_id_category_month_year_key" ON "budgets"("project_id", "category", "month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "cashflow_entries_entry_code_key" ON "cashflow_entries"("entry_code");

-- CreateIndex
CREATE INDEX "cashflow_entries_project_id_idx" ON "cashflow_entries"("project_id");

-- CreateIndex
CREATE INDEX "cashflow_entries_type_idx" ON "cashflow_entries"("type");

-- CreateIndex
CREATE INDEX "cashflow_entries_entry_date_idx" ON "cashflow_entries"("entry_date");

-- CreateIndex
CREATE UNIQUE INDEX "safety_incidents_incident_code_key" ON "safety_incidents"("incident_code");

-- CreateIndex
CREATE INDEX "safety_incidents_project_id_idx" ON "safety_incidents"("project_id");

-- CreateIndex
CREATE INDEX "safety_incidents_severity_idx" ON "safety_incidents"("severity");

-- CreateIndex
CREATE INDEX "timesheets_employee_id_idx" ON "timesheets"("employee_id");

-- CreateIndex
CREATE INDEX "timesheets_project_id_idx" ON "timesheets"("project_id");

-- CreateIndex
CREATE INDEX "timesheets_work_date_idx" ON "timesheets"("work_date");

-- CreateIndex
CREATE UNIQUE INDEX "timesheets_employee_id_project_id_work_date_key" ON "timesheets"("employee_id", "project_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_records_delivery_code_key" ON "delivery_records"("delivery_code");

-- CreateIndex
CREATE INDEX "delivery_records_project_id_idx" ON "delivery_records"("project_id");

-- CreateIndex
CREATE INDEX "delivery_records_status_idx" ON "delivery_records"("status");

-- CreateIndex
CREATE INDEX "file_attachments_entity_type_entity_id_idx" ON "file_attachments"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "piece_rate_contracts_contract_code_key" ON "piece_rate_contracts"("contract_code");

-- CreateIndex
CREATE INDEX "piece_rate_contracts_project_id_idx" ON "piece_rate_contracts"("project_id");

-- CreateIndex
CREATE INDEX "piece_rate_contracts_team_code_idx" ON "piece_rate_contracts"("team_code");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_piece_rate_outputs_contract_id_month_year_key" ON "monthly_piece_rate_outputs"("contract_id", "month", "year");

-- CreateIndex
CREATE INDEX "change_events_project_id_idx" ON "change_events"("project_id");

-- CreateIndex
CREATE INDEX "change_events_source_step_idx" ON "change_events"("source_step");

-- CreateIndex
CREATE INDEX "material_issues_material_id_idx" ON "material_issues"("material_id");

-- CreateIndex
CREATE INDEX "material_issues_heat_number_idx" ON "material_issues"("heat_number");

-- CreateIndex
CREATE INDEX "materials_specification_idx" ON "materials"("specification");

-- CreateIndex
CREATE INDEX "stock_movements_heat_number_idx" ON "stock_movements"("heat_number");

-- CreateIndex
CREATE INDEX "work_orders_workshop_id_idx" ON "work_orders"("workshop_id");

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_contracts" ADD CONSTRAINT "subcontractor_contracts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_contracts" ADD CONSTRAINT "subcontractor_contracts_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_learned" ADD CONSTRAINT "lesson_learned_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_pr_id_fkey" FOREIGN KEY ("pr_id") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mill_certificates" ADD CONSTRAINT "mill_certificates_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mill_certificates" ADD CONSTRAINT "mill_certificates_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_workshop_id_fkey" FOREIGN KEY ("workshop_id") REFERENCES "workshops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_test_plans" ADD CONSTRAINT "inspection_test_plans_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itp_checkpoints" ADD CONSTRAINT "itp_checkpoints_itp_id_fkey" FOREIGN KEY ("itp_id") REFERENCES "inspection_test_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformance_reports" ADD CONSTRAINT "non_conformance_reports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ncr_actions" ADD CONSTRAINT "ncr_actions_ncr_id_fkey" FOREIGN KEY ("ncr_id") REFERENCES "non_conformance_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drawings" ADD CONSTRAINT "drawings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drawing_revisions" ADD CONSTRAINT "drawing_revisions_drawing_id_fkey" FOREIGN KEY ("drawing_id") REFERENCES "drawings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_of_materials" ADD CONSTRAINT "bill_of_materials_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "bill_of_materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "bom_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_change_orders" ADD CONSTRAINT "engineering_change_orders_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_contracts" ADD CONSTRAINT "employee_contracts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_records" ADD CONSTRAINT "salary_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashflow_entries" ADD CONSTRAINT "cashflow_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_incidents" ADD CONSTRAINT "safety_incidents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_records" ADD CONSTRAINT "delivery_records_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_records" ADD CONSTRAINT "delivery_records_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_rate_contracts" ADD CONSTRAINT "piece_rate_contracts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_piece_rate_outputs" ADD CONSTRAINT "monthly_piece_rate_outputs_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "piece_rate_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
