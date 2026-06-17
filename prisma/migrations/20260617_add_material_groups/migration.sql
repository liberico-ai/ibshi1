-- CreateTable
CREATE TABLE "material_groups" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_code" TEXT,
    "level" INTEGER NOT NULL,
    "inactive" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "material_groups_pkey" PRIMARY KEY ("code")
);

-- AddForeignKey (Material.groupCode -> MaterialGroup.code)
-- Note: materials.group_code column already exists from 20260602143040_add_material_code_management
