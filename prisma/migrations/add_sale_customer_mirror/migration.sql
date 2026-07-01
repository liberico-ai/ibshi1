-- CreateTable
CREATE TABLE IF NOT EXISTS "sale_customers" (
    "sale_customer_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "tax_code" TEXT,
    "country" TEXT,
    "address" TEXT,
    "payment_terms" TEXT,
    "name_norm" TEXT,
    "sale_updated_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_customers_pkey" PRIMARY KEY ("sale_customer_id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "sale_customers_name_norm_country_idx" ON "sale_customers"("name_norm", "country");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "sale_customers_sale_updated_at_idx" ON "sale_customers"("sale_updated_at");
