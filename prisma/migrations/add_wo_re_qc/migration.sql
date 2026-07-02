-- AlterTable: add re-QC fields to work_orders
ALTER TABLE "work_orders" ADD COLUMN "needs_re_qc" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "work_orders" ADD COLUMN "re_qc_reason" TEXT;
