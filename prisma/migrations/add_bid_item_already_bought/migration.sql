-- Đợt 2: thêm cột "Đã mua" cho dòng BID (khớp Commerce). Additive.
ALTER TABLE "bid_quote_items" ADD COLUMN IF NOT EXISTS "already_bought_amount" DECIMAL(65,30) NOT NULL DEFAULT 0;
