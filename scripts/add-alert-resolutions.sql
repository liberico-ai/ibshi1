CREATE TABLE IF NOT EXISTS "alert_resolutions" (
  "id" TEXT NOT NULL, "canonical_key" TEXT NOT NULL, "resolved_by" TEXT NOT NULL,
  "resolved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "alert_resolutions_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX IF NOT EXISTS "alert_resolutions_canonical_key_key" ON "alert_resolutions"("canonical_key");
