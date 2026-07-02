-- Track C2: liên kết StockMovement <-> MillCertificate (truy xuất nguồn gốc heat number khi nhận hàng GRN)
ALTER TABLE "stock_movements" ADD COLUMN "mill_certificate_id" TEXT;

CREATE INDEX "stock_movements_mill_certificate_id_idx" ON "stock_movements"("mill_certificate_id");

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_mill_certificate_id_fkey" FOREIGN KEY ("mill_certificate_id") REFERENCES "mill_certificates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
