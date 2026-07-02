-- Đợt 1C: Phiếu thu tiền khách hàng (CustomerReceipt) — thu tiền traceable theo hóa đơn RECEIVABLE
-- paidAmount của Invoice RECEIVABLE = Σ customer_receipts.amount (recompute, không +=)
CREATE TABLE "customer_receipts" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "project_id" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'BANK',
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reference_no" TEXT,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_receipts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_receipts_invoice_id_idx" ON "customer_receipts"("invoice_id");

CREATE INDEX "customer_receipts_project_id_idx" ON "customer_receipts"("project_id");

ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
