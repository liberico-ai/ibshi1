import { z } from 'zod'

// POST /api/tasks/[id]/reject
export const rejectTaskSchema = z.object({
  reason: z.string().min(1, 'Lý do từ chối là bắt buộc'),
  overrideRejectTo: z.string().optional(),
  failedContext: z.record(z.string(), z.any()).optional(),
})

export type RejectTaskInput = z.infer<typeof rejectTaskSchema>

// POST /api/tasks/[id]/comments
export const taskCommentSchema = z.object({
  content: z.string().min(1, 'Nội dung bình luận không được trống').transform((v) => v.trim()),
})

export type TaskCommentInput = z.infer<typeof taskCommentSchema>

// POST /api/tasks/[id] — complete task (result data varies by step)
export const completeTaskSchema = z.object({
  resultData: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().optional(),
})

export type CompleteTaskInput = z.infer<typeof completeTaskSchema>

// POST /api/tasks/activate — activate tasks
export const activateTasksSchema = z.object({
  projectId: z.string().min(1, 'Project ID là bắt buộc'),
  stepCodes: z.array(z.string()).optional(),
})

export type ActivateTasksInput = z.infer<typeof activateTasksSchema>
