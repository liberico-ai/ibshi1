-- ITPCheckpoint: link to auto-created NCR on failure
ALTER TABLE "itp_checkpoints" ADD COLUMN "ncr_id" TEXT;
CREATE INDEX "itp_checkpoints_ncr_id_idx" ON "itp_checkpoints"("ncr_id");
ALTER TABLE "itp_checkpoints" ADD CONSTRAINT "itp_checkpoints_ncr_id_fkey"
  FOREIGN KEY ("ncr_id") REFERENCES "non_conformance_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CertificateRegistry: renewal chain
ALTER TABLE "certificate_registry" ADD COLUMN "renewed_from_id" TEXT;
ALTER TABLE "certificate_registry" ADD CONSTRAINT "certificate_registry_renewed_from_id_fkey"
  FOREIGN KEY ("renewed_from_id") REFERENCES "certificate_registry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
