-- BomItem: thêm diện tích bề mặt + chiều dài đường hàn
ALTER TABLE "bom_items" ADD COLUMN "surface_area_m2" DECIMAL;
ALTER TABLE "bom_items" ADD COLUMN "weld_length_m" DECIMAL;

-- LaborRate: bảng đơn giá công đoạn (Rev2)
CREATE TABLE "labor_rates" (
    "id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "stage_name" TEXT NOT NULL,
    "sub_item" TEXT NOT NULL,
    "unit_price" DECIMAL(65,30) NOT NULL,
    "unit" TEXT NOT NULL,
    "revision" TEXT NOT NULL DEFAULT 'Rev2',
    "effective_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "project_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "labor_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "labor_rates_stage_sub_item_revision_key" ON "labor_rates"("stage", "sub_item", "revision");
CREATE INDEX "labor_rates_project_id_idx" ON "labor_rates"("project_id");
