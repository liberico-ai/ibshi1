-- Đợt 2D: Truy vết nguồn phát sinh PR (revise bản vẽ ECO / sản xuất sai NCR)
-- originType: 'ECO' | 'NCR'; originId: bomVersionId (ECO) hoặc ncr.id (NCR); originLabel: mã hiển thị (ECO-xx-xxx / NCR-xx-xxx)
ALTER TABLE "purchase_requests" ADD COLUMN "origin_type" TEXT;
ALTER TABLE "purchase_requests" ADD COLUMN "origin_id" TEXT;
ALTER TABLE "purchase_requests" ADD COLUMN "origin_label" TEXT;

CREATE INDEX "purchase_requests_origin_type_origin_id_idx" ON "purchase_requests"("origin_type", "origin_id");
