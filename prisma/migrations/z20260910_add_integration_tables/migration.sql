-- Hạ tầng đồng bộ ERP <-> ibs-commerce.
-- Ba bảng chung, không mang nghiệp vụ: nối danh tính, hộp thư đi, nhật ký đồng bộ.

CREATE TABLE IF NOT EXISTS "integration_links" (
  "id"         TEXT PRIMARY KEY,
  "system"     TEXT NOT NULL,
  "entity"     TEXT NOT NULL,
  "local_id"   TEXT NOT NULL,
  "remote_id"  TEXT NOT NULL,
  "ref_code"   TEXT,
  "checksum"   TEXT,
  "remote_at"  TIMESTAMP(3),
  "synced_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "integration_links_system_entity_local_id_key"  ON "integration_links"("system","entity","local_id");
CREATE UNIQUE INDEX IF NOT EXISTS "integration_links_system_entity_remote_id_key" ON "integration_links"("system","entity","remote_id");
CREATE INDEX IF NOT EXISTS "integration_links_system_entity_ref_code_idx"         ON "integration_links"("system","entity","ref_code");

CREATE TABLE IF NOT EXISTS "sync_outbox" (
  "id"           TEXT PRIMARY KEY,
  "system"       TEXT NOT NULL DEFAULT 'commerce',
  "event"        TEXT NOT NULL,
  "entity"       TEXT NOT NULL,
  "entity_id"    TEXT NOT NULL,
  "payload"      JSONB NOT NULL,
  "status"       TEXT NOT NULL DEFAULT 'PENDING',
  "attempts"     INTEGER NOT NULL DEFAULT 0,
  "last_error"   TEXT,
  "idem_key"     TEXT NOT NULL,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sent_at"      TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "sync_outbox_idem_key_key"          ON "sync_outbox"("idem_key");
CREATE INDEX IF NOT EXISTS "sync_outbox_status_available_at_idx"      ON "sync_outbox"("status","available_at");
CREATE INDEX IF NOT EXISTS "sync_outbox_entity_entity_id_idx"         ON "sync_outbox"("entity","entity_id");

CREATE TABLE IF NOT EXISTS "sync_runs" (
  "id"          TEXT PRIMARY KEY,
  "system"      TEXT NOT NULL DEFAULT 'commerce',
  "direction"   TEXT NOT NULL,
  "entity"      TEXT NOT NULL,
  "started_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3),
  "ok"          BOOLEAN NOT NULL DEFAULT false,
  "processed"   INTEGER NOT NULL DEFAULT 0,
  "skipped"     INTEGER NOT NULL DEFAULT 0,
  "failed"      INTEGER NOT NULL DEFAULT 0,
  "cursor"      TIMESTAMP(3),
  "error"       TEXT
);
CREATE INDEX IF NOT EXISTS "sync_runs_system_entity_started_at_idx" ON "sync_runs"("system","entity","started_at");
