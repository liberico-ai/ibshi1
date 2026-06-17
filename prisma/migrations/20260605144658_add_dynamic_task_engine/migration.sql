-- Dynamic Workflow Phase 1: Task / TaskAssignee / TaskDocRequirement / TaskHistory / RoutingSuggestion

CREATE TABLE "tasks" (
  "id" TEXT NOT NULL,
  "project_id" TEXT,
  "parent_id" TEXT,
  "level" INTEGER NOT NULL DEFAULT 2,
  "task_type" TEXT NOT NULL DEFAULT 'FREE',
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "priority" TEXT NOT NULL DEFAULT 'NORMAL',
  "deadline" TIMESTAMP(3),
  "created_by" TEXT NOT NULL,
  "assigned_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "completed_by" TEXT,
  "result_data" JSONB,
  "checklist_template_key" TEXT,
  "checklist_state" JSONB,
  "return_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tasks_project_id_status_idx" ON "tasks"("project_id","status");
CREATE INDEX "tasks_parent_id_idx" ON "tasks"("parent_id");
CREATE INDEX "tasks_status_deadline_idx" ON "tasks"("status","deadline");
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "task_assignees" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "role" TEXT,
  "user_id" TEXT,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "accepted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_assignees_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "task_assignees_task_id_idx" ON "task_assignees"("task_id");
CREATE INDEX "task_assignees_user_id_idx" ON "task_assignees"("user_id");
CREATE INDEX "task_assignees_role_idx" ON "task_assignees"("role");
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "task_doc_requirements" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "file_attachment_id" TEXT,
  "fulfilled" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_doc_requirements_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "task_doc_requirements_task_id_idx" ON "task_doc_requirements"("task_id");
ALTER TABLE "task_doc_requirements" ADD CONSTRAINT "task_doc_requirements_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "task_history" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "by_user_id" TEXT NOT NULL,
  "from_user_id" TEXT,
  "to_role" TEXT,
  "to_user_id" TEXT,
  "reason" TEXT,
  "meta" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "task_history_task_id_idx" ON "task_history"("task_id");
CREATE INDEX "task_history_action_created_at_idx" ON "task_history"("action","created_at");
ALTER TABLE "task_history" ADD CONSTRAINT "task_history_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "routing_suggestions" (
  "id" TEXT NOT NULL,
  "from_context" TEXT NOT NULL,
  "to_role_code" TEXT,
  "to_department_code" TEXT,
  "reason" TEXT NOT NULL,
  "weight" INTEGER NOT NULL DEFAULT 1,
  "source" TEXT NOT NULL DEFAULT 'WORKFLOW_SEED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "routing_suggestions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "routing_suggestions_from_context_idx" ON "routing_suggestions"("from_context");
