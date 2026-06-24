-- CreateTable
CREATE TABLE "briefing_snapshots" (
    "id" TEXT NOT NULL,
    "week_of" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kpi" JSONB NOT NULL,
    "tasks_snapshot" JSONB NOT NULL,
    "decisions" JSONB NOT NULL,
    "action_items" JSONB NOT NULL,

    CONSTRAINT "briefing_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "briefing_snapshots_week_of_key" ON "briefing_snapshots"("week_of");

-- CreateIndex
CREATE INDEX "briefing_snapshots_week_of_idx" ON "briefing_snapshots"("week_of");
