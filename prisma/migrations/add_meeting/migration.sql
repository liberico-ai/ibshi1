-- Lịch họp + lời mời họp (RSVP)
CREATE TABLE IF NOT EXISTS "meetings" (
  "id"           TEXT NOT NULL,
  "project_id"   TEXT,
  "title"        TEXT NOT NULL,
  "agenda"       TEXT,
  "location"     TEXT,
  "starts_at"    TIMESTAMP(3) NOT NULL,
  "ends_at"      TIMESTAMP(3),
  "mom_number"   TEXT,
  "status"       TEXT NOT NULL DEFAULT 'SCHEDULED',
  "minutes_note" TEXT,
  "created_by"   TEXT NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "meetings_project_id_idx" ON "meetings"("project_id");
CREATE INDEX IF NOT EXISTS "meetings_starts_at_idx" ON "meetings"("starts_at");
DO $$ BEGIN
  ALTER TABLE "meetings" ADD CONSTRAINT "meetings_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "meeting_invites" (
  "id"           TEXT NOT NULL,
  "meeting_id"   TEXT NOT NULL,
  "user_id"      TEXT NOT NULL,
  "status"       TEXT NOT NULL DEFAULT 'INVITED',
  "responded_at" TIMESTAMP(3),
  "note"         TEXT,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meeting_invites_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_invites_meeting_id_user_id_key" ON "meeting_invites"("meeting_id", "user_id");
CREATE INDEX IF NOT EXISTS "meeting_invites_user_id_idx" ON "meeting_invites"("user_id");
DO $$ BEGIN
  ALTER TABLE "meeting_invites" ADD CONSTRAINT "meeting_invites_meeting_id_fkey"
    FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
