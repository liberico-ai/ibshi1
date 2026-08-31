-- ASSEMBLY PART LIST (APL) — bảng riêng vì file thật ~25.000 dòng x 47 cột (~15MB JSON),
-- không nhét vừa Task.result_data. Liên kết dự án/công việc là MỀM (không FK), giống ledger_entries.

CREATE TABLE IF NOT EXISTS "apl_imports" (
  "id"                  TEXT PRIMARY KEY,
  "project_id"          TEXT,
  "task_id"             TEXT,
  "file_name"           TEXT NOT NULL,
  "sheet_name"          TEXT NOT NULL,
  "title"               TEXT,
  "revision"            TEXT,
  "header_row"          INTEGER NOT NULL,
  "columns"             JSONB NOT NULL,
  "total_rows"          INTEGER NOT NULL DEFAULT 0,
  "assembly_rows"       INTEGER NOT NULL DEFAULT 0,
  "part_rows"           INTEGER NOT NULL DEFAULT 0,
  "distinct_assemblies" INTEGER NOT NULL DEFAULT 0,
  "scope_units"         INTEGER NOT NULL DEFAULT 1,
  "total_weight_kg"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total_area_m2"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "by_category"         JSONB,
  "warnings"            JSONB,
  "imported_by"         TEXT NOT NULL,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "apl_imports_project_id_idx"  ON "apl_imports"("project_id");
CREATE INDEX IF NOT EXISTS "apl_imports_task_id_idx"     ON "apl_imports"("task_id");
CREATE INDEX IF NOT EXISTS "apl_imports_created_at_idx"  ON "apl_imports"("created_at");

CREATE TABLE IF NOT EXISTS "apl_lines" (
  "id"              TEXT PRIMARY KEY,
  "import_id"       TEXT NOT NULL,
  "row_no"          INTEGER NOT NULL,
  "is_assembly"     BOOLEAN NOT NULL DEFAULT false,
  "seq"             TEXT,
  "drawing_no"      TEXT,
  "assembly"        TEXT,
  "pos"             TEXT,
  "part"            TEXT,
  "mark_cutting"    TEXT,
  "description"     TEXT,
  "profile"         TEXT,
  "grade"           TEXT,
  "type_cutting"    TEXT,
  "thickness_mm"    DOUBLE PRECISION,
  "width_mm"        DOUBLE PRECISION,
  "length_mm"       DOUBLE PRECISION,
  "qty"             DOUBLE PRECISION,
  "unit_weight_kg"  DOUBLE PRECISION,
  "total_weight_kg" DOUBLE PRECISION,
  "area_m2"         DOUBLE PRECISION,
  "category"        TEXT,
  "remark"          TEXT,
  "extra"           JSONB,
  CONSTRAINT "apl_lines_import_id_fkey" FOREIGN KEY ("import_id")
    REFERENCES "apl_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "apl_lines_import_id_idx"               ON "apl_lines"("import_id");
CREATE INDEX IF NOT EXISTS "apl_lines_import_id_assembly_idx"      ON "apl_lines"("import_id", "assembly");
CREATE INDEX IF NOT EXISTS "apl_lines_import_id_part_idx"          ON "apl_lines"("import_id", "part");
CREATE INDEX IF NOT EXISTS "apl_lines_import_id_mark_cutting_idx"  ON "apl_lines"("import_id", "mark_cutting");
