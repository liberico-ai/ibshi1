-- #2 ASL trên Vendor
ALTER TABLE "vendors"
  ADD COLUMN IF NOT EXISTS "asl_status" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "asl_approved_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "asl_approved_by" TEXT,
  ADD COLUMN IF NOT EXISTS "trial_count" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "vendors_asl_status_idx" ON "vendors" ("asl_status");

-- #3 duyệt PR
ALTER TABLE "purchase_requests"
  ADD COLUMN IF NOT EXISTS "submitted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pr_reject_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "pr_rejected_by" TEXT;

-- #2 SupplierEvaluation
CREATE TABLE IF NOT EXISTS "supplier_evaluations" (
  "id" TEXT PRIMARY KEY, "vendor_id" TEXT NOT NULL, "evaluated_by" TEXT NOT NULL,
  "evaluated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "score_contact_price" INTEGER NOT NULL DEFAULT 0, "score_quality" INTEGER NOT NULL DEFAULT 0,
  "score_delivery" INTEGER NOT NULL DEFAULT 0, "score_exclusive" INTEGER NOT NULL DEFAULT 0,
  "is_customer_designated" BOOLEAN NOT NULL DEFAULT false, "has_iso9001" BOOLEAN NOT NULL DEFAULT false,
  "sample_eval_passed" BOOLEAN NOT NULL DEFAULT false, "score_attitude" INTEGER NOT NULL DEFAULT 0,
  "overall_result" TEXT NOT NULL DEFAULT 'PENDING', "decision" TEXT, "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "supplier_evaluations_vendor_idx" ON "supplier_evaluations" ("vendor_id");

-- #2 SupplierViolation
CREATE TABLE IF NOT EXISTS "supplier_violations" (
  "id" TEXT PRIMARY KEY, "vendor_id" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "description" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'MINOR', "status" TEXT NOT NULL DEFAULT 'OPEN',
  "resolved_at" TIMESTAMP(3), "resolved_by" TEXT, "note" TEXT, "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "supplier_violations_vendor_idx" ON "supplier_violations" ("vendor_id");
CREATE INDEX IF NOT EXISTS "supplier_violations_status_idx" ON "supplier_violations" ("status");

-- #1 PaymentRequest
CREATE TABLE IF NOT EXISTS "payment_requests" (
  "id" TEXT PRIMARY KEY, "code" TEXT NOT NULL UNIQUE, "project_id" TEXT, "contract_id" TEXT,
  "vendor_id" TEXT NOT NULL, "amount" DECIMAL NOT NULL DEFAULT 0, "currency" TEXT NOT NULL DEFAULT 'VND',
  "description" TEXT, "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "has_doc_contract" BOOLEAN NOT NULL DEFAULT false, "has_doc_invoice" BOOLEAN NOT NULL DEFAULT false,
  "has_doc_vendor_req" BOOLEAN NOT NULL DEFAULT false, "has_doc_handover" BOOLEAN NOT NULL DEFAULT false,
  "qlda_by" TEXT, "qlda_at" TIMESTAMP(3), "tmktt_by" TEXT, "tmktt_at" TIMESTAMP(3),
  "gdda_by" TEXT, "gdda_at" TIMESTAMP(3), "reject_by" TEXT, "reject_at" TIMESTAMP(3), "reject_reason" TEXT,
  "paid_at" TIMESTAMP(3), "paid_by" TEXT, "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "payment_requests_project_idx" ON "payment_requests" ("project_id");
CREATE INDEX IF NOT EXISTS "payment_requests_vendor_idx" ON "payment_requests" ("vendor_id");
CREATE INDEX IF NOT EXISTS "payment_requests_status_idx" ON "payment_requests" ("status");
DO $$ BEGIN ALTER TABLE "supplier_evaluations" ADD CONSTRAINT "se_vendor_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "supplier_violations" ADD CONSTRAINT "sv_vendor_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "payment_requests" ADD CONSTRAINT "pr_vendor_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id"); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "payment_requests" ADD CONSTRAINT "pr_project_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id"); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "payment_requests" ADD CONSTRAINT "pr_contract_fkey" FOREIGN KEY ("contract_id") REFERENCES "purchase_contracts"("id"); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
