-- Track B: Quyết toán dự án (ProjectSettlement) — 1 quyết toán/dự án, gate bắt buộc APPROVED trước khi đóng dự án
CREATE TABLE "project_settlements" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "revenue_contract" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "revenue_invoiced" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "revenue_collected" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "cost_material" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "cost_labor" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "cost_service" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "cost_other" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "profit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "margin_pct" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "snapshot" JSONB,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_settlements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_settlements_project_id_key" ON "project_settlements"("project_id");

CREATE INDEX "project_settlements_status_idx" ON "project_settlements"("status");

ALTER TABLE "project_settlements" ADD CONSTRAINT "project_settlements_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
