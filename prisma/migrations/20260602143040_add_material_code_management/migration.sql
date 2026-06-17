-- Material code management: alias registry + atomic counter + lifecycle/provisional fields

-- 1. New columns on materials
ALTER TABLE "materials" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "materials" ADD COLUMN "is_provisional" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "materials" ADD COLUMN "created_by_unit" TEXT;
CREATE INDEX "materials_status_idx" ON "materials"("status");

-- 2. Alias registry — one old code maps to exactly one material
CREATE TABLE "material_code_aliases" (
    "id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "alias_code" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "material_code_aliases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "material_code_aliases_alias_code_key" ON "material_code_aliases"("alias_code");
CREATE INDEX "material_code_aliases_material_id_idx" ON "material_code_aliases"("material_id");
CREATE INDEX "material_code_aliases_alias_code_idx" ON "material_code_aliases"("alias_code");
ALTER TABLE "material_code_aliases" ADD CONSTRAINT "material_code_aliases_material_id_fkey"
    FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Atomic sequence counter per (prefix, subgroup)
CREATE TABLE "material_code_counters" (
    "prefix" TEXT NOT NULL,
    "subgroup" TEXT NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "material_code_counters_pkey" PRIMARY KEY ("prefix","subgroup")
);
