import { z } from 'zod'

// ── Dynamic Workflow (Phase 1) ──

export const taskAssigneeInput = z.object({
  role: z.string().optional(),
  userId: z.string().optional(),
  isPrimary: z.boolean().optional(),
}).refine((a) => a.role || a.userId, { message: 'Mỗi người nhận cần role hoặc userId' })

export const taskDocInput = z.object({
  kind: z.enum(['MUST_READ', 'MUST_RETURN']),
  label: z.string().min(1),
  fileAttachmentId: z.string().optional(),
  key: z.string().optional(), // khóa ổn định để gắn tệp nháp → tài liệu khi tạo task
})

export const createTaskSchema = z.object({
  title: z.string().min(1, 'Tiêu đề là bắt buộc'),
  description: z.string().optional(),
  projectId: z.string().optional(),
  parentId: z.string().optional(),            // có → là subtask
  taskType: z.string().default('FREE'),
  priority: z.enum(['NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  deadline: z.string().datetime().optional().or(z.string().optional()),
  assignees: z.array(taskAssigneeInput).min(1, 'Cần ít nhất 1 nơi nhận'),
  docs: z.array(taskDocInput).optional(),
  checklistTemplateKey: z.string().optional(),
  draftId: z.string().optional(),
  forwardedFromId: z.string().optional(),
  template: z.enum(['ESTIMATE', 'PR', 'BBH', 'WBS', 'WELD_PAINT', 'BOM', 'SUPPLIER_QUOTE']).optional(),
})
export type CreateTaskInput = z.infer<typeof createTaskSchema>

export const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  deadline: z.string().nullable().optional(),
  priority: z.enum(['NORMAL', 'HIGH', 'URGENT']).optional(),
})
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>

export const returnTaskSchema = z.object({
  reason: z.string().min(1, 'Cần nêu lý do trả lại (sai phạm vi)'),
})
export type ReturnTaskInput = z.infer<typeof returnTaskSchema>

// Việc "chuyển tiếp sang bộ phận khác" khi hoàn thành (option 2)
export const forwardInput = z.object({
  title: z.string().min(1).optional(),
  taskType: z.string().default('FREE'),
  deadline: z.string().datetime().optional().or(z.string().optional()),
  assignees: z.array(taskAssigneeInput).min(1, 'Cần chọn nơi nhận để chuyển tiếp'),
  docs: z.array(taskDocInput).optional(),
  note: z.string().optional(),
})

export const completeWorkTaskSchema = z.object({
  // RETURN_CREATOR = hoàn thành & trả người tạo (mặc định) | FORWARD = hoàn thành & chuyển tiếp
  mode: z.enum(['RETURN_CREATOR', 'FORWARD']).default('RETURN_CREATOR'),
  forward: forwardInput.optional(),
  resultData: z.record(z.string(), z.unknown()).optional(),
  // Tài liệu MUST_READ đã được tick "đã đọc"
  acknowledgedDocIds: z.array(z.string()).optional(),
  // Tài liệu MUST_RETURN: mỗi mục cần note (text) HOẶC fileAttachmentId
  returnedDocs: z
    .array(
      z.object({
        requirementId: z.string(),
        fileAttachmentId: z.string().optional(),
        note: z.string().optional(),
      })
    )
    .optional(),
  note: z.string().optional(),
})
export type CompleteWorkTaskInput = z.infer<typeof completeWorkTaskSchema>

export const reassignTaskSchema = z.object({
  assignees: z.array(taskAssigneeInput).min(1),
  note: z.string().optional(),
})
export type ReassignTaskInput = z.infer<typeof reassignTaskSchema>

// Yêu cầu chỉnh sửa việc (người tạo gửi) — Xóa việc / Sửa người nhận + lý do
export const changeRequestSchema = z.object({
  type: z.enum(['DELETE', 'EDIT_ASSIGNEES']),
  reason: z.string().min(1, 'Cần nhập lý do'),
})
export type ChangeRequestInput = z.infer<typeof changeRequestSchema>

// QTHT xử lý yêu cầu — thực hiện (kèm assignees mới nếu recall) hoặc từ chối
export const resolveChangeRequestSchema = z.object({
  action: z.enum(['EXECUTE', 'REJECT']),
  note: z.string().optional(),
  assignees: z.array(taskAssigneeInput).optional(),
})
export type ResolveChangeRequestInput = z.infer<typeof resolveChangeRequestSchema>

export const commentSchema = z.object({ content: z.string().min(1) })
export type CommentInput = z.infer<typeof commentSchema>

// ── Lịch họp ──
export const createMeetingSchema = z.object({
  title: z.string().min(1, 'Cần tiêu đề cuộc họp'),
  projectId: z.string().optional(),
  taskId: z.string().optional(),
  agenda: z.string().optional(),
  location: z.string().optional(),
  startsAt: z.string().datetime().or(z.string().min(1, 'Cần thời gian họp')),
  endsAt: z.string().datetime().optional().or(z.string().optional()),
  inviteUserIds: z.array(z.string()).min(1, 'Cần mời ít nhất 1 người'),
  draftId: z.string().optional(),
})
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>

export const respondMeetingSchema = z.object({
  status: z.enum(['ACCEPTED', 'DECLINED']),
  note: z.string().optional(),
})

// Biên bản họp (MOM) — cấu trúc theo mẫu hệ cũ P1.2A
export const momItemSchema = z.object({
  noiDung: z.string().optional(),   // Nội dung
  actionBy: z.string().optional(),  // Người thực hiện
  dueDate: z.string().optional(),   // Hạn
  remark: z.string().optional(),    // Ghi chú
})
export const closeMeetingSchema = z.object({
  minutesNote: z.string().optional(),
  momNumber: z.string().optional(),
  preparedBy: z.string().optional(), // Người lập
  place: z.string().optional(),      // Địa điểm
  items: z.array(momItemSchema).optional(), // Các mục hành động
})

export const inboxQuerySchema = z.object({
  tab: z.enum(['assigned', 'review', 'dept', 'created', 'overdue', 'done']).default('assigned'),
  page: z.coerce.number().min(1).default(1),
  q: z.string().optional(),
  projectId: z.string().optional(),
})
export type InboxQueryInput = z.infer<typeof inboxQuerySchema>
