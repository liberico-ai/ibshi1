-- Phase 3: workflow templates + Task hook fields

ALTER TABLE "tasks" ADD COLUMN "hook_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "tasks" ADD COLUMN "template_step_id" TEXT;

CREATE TABLE "workflow_templates" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "project_type" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workflow_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "workflow_templates_code_key" ON "workflow_templates"("code");
CREATE INDEX "workflow_templates_project_type_is_active_idx" ON "workflow_templates"("project_type","is_active");

CREATE TABLE "template_steps" (
  "id" TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "role_code" TEXT,
  "dept_code" TEXT,
  "order_index" INTEGER NOT NULL DEFAULT 0,
  "deadline_days" INTEGER,
  "task_type" TEXT NOT NULL DEFAULT 'FREE',
  "hook_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "parent_code" TEXT,
  CONSTRAINT "template_steps_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "template_steps_template_id_idx" ON "template_steps"("template_id");
ALTER TABLE "template_steps" ADD CONSTRAINT "template_steps_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "workflow_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
