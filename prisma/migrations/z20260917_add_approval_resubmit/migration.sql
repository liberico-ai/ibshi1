-- Cho phép Thương mại trình lại một đợt báo giá đã bị BGĐ trả lại.
-- Hai cột giữ dấu vết để lần duyệt sau BGĐ biết trước đó đã yêu cầu sửa gì.

ALTER TABLE "commerce_approvals"
  ADD COLUMN IF NOT EXISTS "so_lan_trinh" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "ly_do_tra_lai_truoc" TEXT;
