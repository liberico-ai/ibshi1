-- BUILD #5: Logistics — PackingList + Shipment (ADDITIVE, no backfill)

-- ── Packing Lists ──
CREATE TABLE "packing_lists" (
  "id"           TEXT NOT NULL,
  "pl_code"      TEXT NOT NULL,
  "project_id"   TEXT NOT NULL,
  "status"       TEXT NOT NULL DEFAULT 'DRAFT',
  "total_weight" DECIMAL,
  "total_pieces" INT NOT NULL DEFAULT 0,
  "dimensions"   TEXT,
  "notes"        TEXT,
  "created_by"   TEXT NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "packing_lists_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "packing_lists_pl_code_key" ON "packing_lists"("pl_code");
CREATE INDEX "packing_lists_project_id_idx" ON "packing_lists"("project_id");
CREATE INDEX "packing_lists_status_idx" ON "packing_lists"("status");

ALTER TABLE "packing_lists"
  ADD CONSTRAINT "packing_lists_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT;

-- ── Packing List Items (piece-marks in a packing list) ──
CREATE TABLE "packing_list_items" (
  "id"              TEXT NOT NULL,
  "packing_list_id" TEXT NOT NULL,
  "work_order_id"   TEXT NOT NULL,
  "piece_mark"      TEXT NOT NULL,
  "description"     TEXT,
  "weight"          DECIMAL,
  "quantity"        INT NOT NULL DEFAULT 1,
  "qc_status"       TEXT NOT NULL DEFAULT 'PENDING',
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "packing_list_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "packing_list_items_packing_list_id_idx" ON "packing_list_items"("packing_list_id");
CREATE INDEX "packing_list_items_work_order_id_idx" ON "packing_list_items"("work_order_id");

ALTER TABLE "packing_list_items"
  ADD CONSTRAINT "packing_list_items_packing_list_id_fkey"
  FOREIGN KEY ("packing_list_id") REFERENCES "packing_lists"("id") ON DELETE CASCADE;

ALTER TABLE "packing_list_items"
  ADD CONSTRAINT "packing_list_items_work_order_id_fkey"
  FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT;

-- ── Shipments ──
CREATE TABLE "shipments" (
  "id"              TEXT NOT NULL,
  "shipment_code"   TEXT NOT NULL,
  "project_id"      TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'PENDING',
  "vehicle_no"      TEXT,
  "driver_name"     TEXT,
  "driver_phone"    TEXT,
  "destination"     TEXT,
  "shipped_at"      TIMESTAMP(3),
  "arrived_at"      TIMESTAMP(3),
  "received_by"     TEXT,
  "received_at"     TIMESTAMP(3),
  "total_weight"    DECIMAL,
  "total_pieces"    INT NOT NULL DEFAULT 0,
  "notes"           TEXT,
  "created_by"      TEXT NOT NULL,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shipments_shipment_code_key" ON "shipments"("shipment_code");
CREATE INDEX "shipments_project_id_idx" ON "shipments"("project_id");
CREATE INDEX "shipments_status_idx" ON "shipments"("status");

ALTER TABLE "shipments"
  ADD CONSTRAINT "shipments_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT;

-- ── Shipment Items (packing lists loaded into a shipment) ──
CREATE TABLE "shipment_items" (
  "id"              TEXT NOT NULL,
  "shipment_id"     TEXT NOT NULL,
  "packing_list_id" TEXT NOT NULL,
  "loaded_at"       TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shipment_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shipment_items_shipment_packing_key" ON "shipment_items"("shipment_id", "packing_list_id");
CREATE INDEX "shipment_items_shipment_id_idx" ON "shipment_items"("shipment_id");
CREATE INDEX "shipment_items_packing_list_id_idx" ON "shipment_items"("packing_list_id");

ALTER TABLE "shipment_items"
  ADD CONSTRAINT "shipment_items_shipment_id_fkey"
  FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE;

ALTER TABLE "shipment_items"
  ADD CONSTRAINT "shipment_items_packing_list_id_fkey"
  FOREIGN KEY ("packing_list_id") REFERENCES "packing_lists"("id") ON DELETE RESTRICT;
