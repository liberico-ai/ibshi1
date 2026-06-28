-- BUILD #4: Production enhancements
-- ADDITIVE only, nullable columns, no backfill needed

-- A. WorkOrder: add pieceMark, bomVersionId, plannedWeight for ton-based tracking
ALTER TABLE "work_orders" ADD COLUMN "piece_mark" TEXT;
ALTER TABLE "work_orders" ADD COLUMN "bom_version_id" TEXT;
ALTER TABLE "work_orders" ADD COLUMN "planned_weight" DECIMAL;
ALTER TABLE "work_orders" ADD COLUMN "department_id" TEXT;

CREATE INDEX "work_orders_bom_version_id_idx" ON "work_orders"("bom_version_id");
CREATE INDEX "work_orders_department_id_idx" ON "work_orders"("department_id");
CREATE INDEX "work_orders_piece_mark_idx" ON "work_orders"("piece_mark");

ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_bom_version_id_fkey"
  FOREIGN KEY ("bom_version_id") REFERENCES "bom_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- D. Weld joints table
CREATE TABLE "weld_joints" (
  "id" TEXT NOT NULL,
  "work_order_id" TEXT NOT NULL,
  "joint_no" TEXT NOT NULL,
  "joint_type" TEXT NOT NULL DEFAULT 'BUTT',
  "wps_no" TEXT,
  "welder_id" TEXT,
  "welder_cert_id" TEXT,
  "diameter" DECIMAL,
  "thickness" DECIMAL,
  "length" DECIMAL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "welded_at" TIMESTAMP(3),
  "ndt_status" TEXT DEFAULT 'PENDING',
  "ndt_method" TEXT,
  "ncr_id" TEXT,
  "remarks" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "weld_joints_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "weld_joints_work_order_id_idx" ON "weld_joints"("work_order_id");
CREATE INDEX "weld_joints_welder_id_idx" ON "weld_joints"("welder_id");
CREATE INDEX "weld_joints_status_idx" ON "weld_joints"("status");
CREATE INDEX "weld_joints_ndt_status_idx" ON "weld_joints"("ndt_status");
CREATE UNIQUE INDEX "weld_joints_work_order_id_joint_no_key" ON "weld_joints"("work_order_id", "joint_no");

ALTER TABLE "weld_joints" ADD CONSTRAINT "weld_joints_work_order_id_fkey"
  FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "weld_joints" ADD CONSTRAINT "weld_joints_welder_id_fkey"
  FOREIGN KEY ("welder_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "weld_joints" ADD CONSTRAINT "weld_joints_ncr_id_fkey"
  FOREIGN KEY ("ncr_id") REFERENCES "non_conformance_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
