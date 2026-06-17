-- Biên bản họp có cấu trúc (MOM theo mẫu hệ cũ P1.2A): người lập, địa điểm, mục hành động
ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "minutes_data" JSONB;
