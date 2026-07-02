-- AlterTable: add product_type to workflow_templates (nullable = generic template)
ALTER TABLE "workflow_templates" ADD COLUMN "product_type" TEXT;
