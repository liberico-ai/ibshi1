-- Add project_id to purchase_orders (nullable: legacy PO + future flexibility)
ALTER TABLE "purchase_orders" ADD COLUMN "project_id" TEXT;

-- Index for faster project → PO lookups
CREATE INDEX "purchase_orders_project_id_idx" ON "purchase_orders"("project_id");

-- FK to projects (no cascade — keep PO history if project deleted)
ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: for each PO, find the P3.6 workflow task whose resultData.groups[].prCode matches po_code.
-- This reverse-lookup recovers project_id for legacy POs created before this column existed.
UPDATE "purchase_orders" po
SET    "project_id" = sub.project_id
FROM   (
  SELECT po2.id AS po_id, wt.project_id
  FROM   "purchase_orders" po2
  JOIN   "workflow_tasks" wt
         ON wt.step_code = 'P3.6'
         AND EXISTS (
           SELECT 1
           FROM   jsonb_array_elements(COALESCE(wt.result_data->'groups', '[]'::jsonb)) AS g
           WHERE  g->>'prCode' = po2.po_code
         )
) AS sub
WHERE po.id = sub.po_id;
