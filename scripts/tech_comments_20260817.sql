-- Làm rõ kỹ thuật (PORT Thương Mại — F2) — bảng mới tech_comments, additive an toàn.
-- Áp tay vào DB dev (team không dùng prisma migrate dev).

CREATE TABLE IF NOT EXISTS "tech_comments" (
    "id" TEXT NOT NULL,
    "pr_item_id" TEXT NOT NULL,
    "author_id" TEXT,
    "content" TEXT NOT NULL,
    "comment_type" TEXT NOT NULL DEFAULT 'NOTE',
    "thread_status" TEXT,
    "tags" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tech_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tech_comments_pr_item_id_idx" ON "tech_comments"("pr_item_id");
CREATE INDEX IF NOT EXISTS "tech_comments_author_id_idx" ON "tech_comments"("author_id");
CREATE INDEX IF NOT EXISTS "tech_comments_comment_type_idx" ON "tech_comments"("comment_type");

DO $$ BEGIN
    ALTER TABLE "tech_comments" ADD CONSTRAINT "tech_comments_pr_item_id_fkey" FOREIGN KEY ("pr_item_id") REFERENCES "purchase_request_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "tech_comments" ADD CONSTRAINT "tech_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
