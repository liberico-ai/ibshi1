-- P2e: Normalized supplier quote groups (from P3.6 resultData JSON)

CREATE TABLE "quote_groups" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "project_id" TEXT,
    "group_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "total_value" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "pr_code" TEXT,
    "payment_status" TEXT,
    "delivery_date" TIMESTAMP(3),
    "payment_date" TIMESTAMP(3),
    "assigned_supplier" TEXT,
    "rejected_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quote_group_items" (
    "id" TEXT NOT NULL,
    "quote_group_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "spec" TEXT,
    "unit" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT '',
    "quantity" TEXT NOT NULL DEFAULT '0',
    "requested_qty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "in_stock" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "shortfall" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "spec_match" BOOLEAN NOT NULL DEFAULT false,
    "matched_material" JSONB,
    "selected_quote_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_group_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_quote_lines" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "line_index" INTEGER NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "unit_price" DECIMAL(65,30) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_quote_lines_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "quote_groups_project_id_idx" ON "quote_groups"("project_id");
CREATE INDEX "quote_groups_status_idx" ON "quote_groups"("status");
CREATE UNIQUE INDEX "quote_groups_task_id_group_key_key" ON "quote_groups"("task_id", "group_key");

CREATE INDEX "quote_group_items_quote_group_id_idx" ON "quote_group_items"("quote_group_id");

CREATE INDEX "supplier_quote_lines_item_id_idx" ON "supplier_quote_lines"("item_id");
CREATE UNIQUE INDEX "supplier_quote_lines_item_id_line_index_key" ON "supplier_quote_lines"("item_id", "line_index");

-- Foreign keys
ALTER TABLE "quote_groups" ADD CONSTRAINT "quote_groups_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_groups" ADD CONSTRAINT "quote_groups_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "quote_group_items" ADD CONSTRAINT "quote_group_items_quote_group_id_fkey" FOREIGN KEY ("quote_group_id") REFERENCES "quote_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "supplier_quote_lines" ADD CONSTRAINT "supplier_quote_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "quote_group_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
