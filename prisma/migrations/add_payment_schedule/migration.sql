-- Đợt 5: Lịch thanh toán (PaymentSchedule). Bảng mới hoàn toàn — additive.
CREATE TABLE IF NOT EXISTS "payment_schedules" (
    "id"                TEXT NOT NULL,
    "project_id"        TEXT,
    "purchase_order_id" TEXT,
    "supplier"          TEXT NOT NULL,
    "sale_contract"     TEXT,
    "value"             DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currency"          TEXT NOT NULL DEFAULT 'VND',
    "payment_method"    TEXT,
    "sign_date"         TIMESTAMP(3),
    "lc_date"           TIMESTAMP(3),
    "etd"               TIMESTAMP(3),
    "eta"               TIMESTAMP(3),
    "document_date"     TIMESTAMP(3),
    "lc_deadline"       TIMESTAMP(3),
    "payment_month"     TEXT,
    "status"            TEXT NOT NULL DEFAULT 'PLANNED',
    "paid_date"         TIMESTAMP(3),
    "paid_amount"       DECIMAL(65,30),
    "notes"             TEXT,
    "created_by"        TEXT,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_schedules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_schedules_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "payment_schedules_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "payment_schedules_project_id_idx" ON "payment_schedules"("project_id");
CREATE INDEX IF NOT EXISTS "payment_schedules_purchase_order_id_idx" ON "payment_schedules"("purchase_order_id");
