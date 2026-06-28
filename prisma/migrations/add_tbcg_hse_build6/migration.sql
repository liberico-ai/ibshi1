-- BUILD #6: TBCG + HSE (ADDITIVE, no backfill)

-- ── Equipment Registry ──
CREATE TABLE "equipment" (
  "id"                 TEXT NOT NULL,
  "equipment_code"     TEXT NOT NULL,
  "name"               TEXT NOT NULL,
  "category"           TEXT NOT NULL DEFAULT 'OTHER',
  "model"              TEXT,
  "serial_no"          TEXT,
  "manufacturer"       TEXT,
  "location"           TEXT,
  "department_id"      TEXT,
  "status"             TEXT NOT NULL DEFAULT 'AVAILABLE',
  "condition"          TEXT NOT NULL DEFAULT 'GOOD',
  "purchase_date"      TIMESTAMP(3),
  "inspection_due"     TIMESTAMP(3),
  "last_inspection"    TIMESTAMP(3),
  "notes"              TEXT,
  "created_by"         TEXT NOT NULL,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "equipment_equipment_code_key" ON "equipment"("equipment_code");
CREATE INDEX "equipment_department_id_idx" ON "equipment"("department_id");
CREATE INDEX "equipment_status_idx" ON "equipment"("status");
CREATE INDEX "equipment_inspection_due_idx" ON "equipment"("inspection_due");

ALTER TABLE "equipment"
  ADD CONSTRAINT "equipment_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL;

-- ── Maintenance Records ──
CREATE TABLE "maintenance_records" (
  "id"              TEXT NOT NULL,
  "maint_code"      TEXT NOT NULL,
  "equipment_id"    TEXT NOT NULL,
  "type"            TEXT NOT NULL DEFAULT 'PREVENTIVE',
  "description"     TEXT NOT NULL,
  "scheduled_date"  TIMESTAMP(3),
  "completed_date"  TIMESTAMP(3),
  "cost"            DECIMAL,
  "performed_by"    TEXT,
  "status"          TEXT NOT NULL DEFAULT 'SCHEDULED',
  "task_id"         TEXT,
  "notes"           TEXT,
  "created_by"      TEXT NOT NULL,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "maintenance_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "maintenance_records_maint_code_key" ON "maintenance_records"("maint_code");
CREATE INDEX "maintenance_records_equipment_id_idx" ON "maintenance_records"("equipment_id");
CREATE INDEX "maintenance_records_status_idx" ON "maintenance_records"("status");
CREATE INDEX "maintenance_records_type_idx" ON "maintenance_records"("type");

ALTER TABLE "maintenance_records"
  ADD CONSTRAINT "maintenance_records_equipment_id_fkey"
  FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE CASCADE;

-- ── Equipment Assignment (link equipment ↔ WorkOrder/dept) ──
CREATE TABLE "equipment_assignments" (
  "id"            TEXT NOT NULL,
  "equipment_id"  TEXT NOT NULL,
  "work_order_id" TEXT,
  "department_id" TEXT,
  "assigned_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assigned_to"   TIMESTAMP(3),
  "status"        TEXT NOT NULL DEFAULT 'ACTIVE',
  "notes"         TEXT,
  "created_by"    TEXT NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "equipment_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "equipment_assignments_equipment_id_idx" ON "equipment_assignments"("equipment_id");
CREATE INDEX "equipment_assignments_work_order_id_idx" ON "equipment_assignments"("work_order_id");
CREATE INDEX "equipment_assignments_department_id_idx" ON "equipment_assignments"("department_id");

ALTER TABLE "equipment_assignments"
  ADD CONSTRAINT "equipment_assignments_equipment_id_fkey"
  FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE CASCADE;

ALTER TABLE "equipment_assignments"
  ADD CONSTRAINT "equipment_assignments_work_order_id_fkey"
  FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL;

ALTER TABLE "equipment_assignments"
  ADD CONSTRAINT "equipment_assignments_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL;

-- ── Work Permits ──
CREATE TABLE "work_permits" (
  "id"            TEXT NOT NULL,
  "permit_code"   TEXT NOT NULL,
  "permit_type"   TEXT NOT NULL DEFAULT 'HOT_WORK',
  "project_id"    TEXT,
  "work_order_id" TEXT,
  "location"      TEXT,
  "description"   TEXT NOT NULL,
  "hazards"       TEXT,
  "precautions"   TEXT,
  "valid_from"    TIMESTAMP(3) NOT NULL,
  "valid_to"      TIMESTAMP(3) NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'DRAFT',
  "requested_by"  TEXT NOT NULL,
  "approved_by"   TEXT,
  "approved_at"   TIMESTAMP(3),
  "closed_by"     TEXT,
  "closed_at"     TIMESTAMP(3),
  "notes"         TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "work_permits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "work_permits_permit_code_key" ON "work_permits"("permit_code");
CREATE INDEX "work_permits_project_id_idx" ON "work_permits"("project_id");
CREATE INDEX "work_permits_status_idx" ON "work_permits"("status");
CREATE INDEX "work_permits_permit_type_idx" ON "work_permits"("permit_type");

ALTER TABLE "work_permits"
  ADD CONSTRAINT "work_permits_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;

ALTER TABLE "work_permits"
  ADD CONSTRAINT "work_permits_work_order_id_fkey"
  FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL;

-- ── Toolbox Talks ──
CREATE TABLE "toolbox_talks" (
  "id"            TEXT NOT NULL,
  "talk_code"     TEXT NOT NULL,
  "department_id" TEXT,
  "talk_date"     TIMESTAMP(3) NOT NULL,
  "topic"         TEXT NOT NULL,
  "content"       TEXT,
  "attendees"     INT NOT NULL DEFAULT 0,
  "conducted_by"  TEXT NOT NULL,
  "notes"         TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "toolbox_talks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "toolbox_talks_talk_code_key" ON "toolbox_talks"("talk_code");
CREATE INDEX "toolbox_talks_department_id_idx" ON "toolbox_talks"("department_id");
CREATE INDEX "toolbox_talks_talk_date_idx" ON "toolbox_talks"("talk_date");

ALTER TABLE "toolbox_talks"
  ADD CONSTRAINT "toolbox_talks_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL;

-- ── Enhance SafetyIncident with investigation fields ──
ALTER TABLE "safety_incidents" ADD COLUMN "investigated_by" TEXT;
ALTER TABLE "safety_incidents" ADD COLUMN "investigation_date" TIMESTAMP(3);
ALTER TABLE "safety_incidents" ADD COLUMN "closed_by" TEXT;
ALTER TABLE "safety_incidents" ADD COLUMN "closed_at" TIMESTAMP(3);
ALTER TABLE "safety_incidents" ADD COLUMN "lost_time_days" INT DEFAULT 0;
ALTER TABLE "safety_incidents" ADD COLUMN "task_id" TEXT;
