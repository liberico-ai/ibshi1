-- Module Phân bổ chế tạo (PORT Thương Mại) — 2 bảng mới, additive an toàn.
-- Áp tay vào DB dev (team không dùng prisma migrate dev — lịch sử migration đã lệch).
-- Nguồn: prisma migrate diff (DB thật ↔ schema), chỉ trích 2 bảng fab.

CREATE TABLE IF NOT EXISTS "fabrication_categories" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "ghi_chu" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fabrication_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pr_item_fab_allocations" (
    "id" TEXT NOT NULL,
    "pr_item_id" TEXT NOT NULL,
    "fabrication_category_id" TEXT NOT NULL,
    "qty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "weight" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "ngay_can_tai_cong_truong" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pr_item_fab_allocations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "fabrication_categories_project_id_idx" ON "fabrication_categories"("project_id");
CREATE UNIQUE INDEX IF NOT EXISTS "fabrication_categories_project_id_code_key" ON "fabrication_categories"("project_id", "code");
CREATE INDEX IF NOT EXISTS "pr_item_fab_allocations_pr_item_id_idx" ON "pr_item_fab_allocations"("pr_item_id");
CREATE INDEX IF NOT EXISTS "pr_item_fab_allocations_fabrication_category_id_idx" ON "pr_item_fab_allocations"("fabrication_category_id");
CREATE UNIQUE INDEX IF NOT EXISTS "pr_item_fab_allocations_pr_item_id_fabrication_category_id_key" ON "pr_item_fab_allocations"("pr_item_id", "fabrication_category_id");

DO $$ BEGIN
    ALTER TABLE "fabrication_categories" ADD CONSTRAINT "fabrication_categories_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "pr_item_fab_allocations" ADD CONSTRAINT "pr_item_fab_allocations_pr_item_id_fkey" FOREIGN KEY ("pr_item_id") REFERENCES "purchase_request_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "pr_item_fab_allocations" ADD CONSTRAINT "pr_item_fab_allocations_fabrication_category_id_fkey" FOREIGN KEY ("fabrication_category_id") REFERENCES "fabrication_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
