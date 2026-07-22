-- Revise Flow36 · Phase 0 — additive, behavior-identical (default revision_round = 0).
-- Idempotent (ADD COLUMN IF NOT EXISTS) vì prod≠local; áp UAT trước, prod theo đợt deploy lớn.
-- KHÔNG thêm @@unique(template_step_id, revision_round) ở MVP (Q5 — dedup application-level).
-- status GIỮ String; giá trị 'SKIPPED_NO_IMPACT' là chuỗi mới (Phase 1), KHÔNG cần migration.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "revision_round" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "revision_id" TEXT;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "origin_step_code" TEXT;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "skip_reason" TEXT;
