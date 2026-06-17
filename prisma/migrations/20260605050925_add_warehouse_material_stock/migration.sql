-- Per-warehouse (per-project) inventory: Warehouse + MaterialStock

CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "project_code" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");
CREATE INDEX "warehouses_project_code_idx" ON "warehouses"("project_code");

CREATE TABLE "material_stocks" (
    "id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "value" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "material_stocks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "material_stocks_material_id_warehouse_id_key" ON "material_stocks"("material_id","warehouse_id");
CREATE INDEX "material_stocks_material_id_idx" ON "material_stocks"("material_id");
CREATE INDEX "material_stocks_warehouse_id_idx" ON "material_stocks"("warehouse_id");
ALTER TABLE "material_stocks" ADD CONSTRAINT "material_stocks_material_id_fkey"
    FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_stocks" ADD CONSTRAINT "material_stocks_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
