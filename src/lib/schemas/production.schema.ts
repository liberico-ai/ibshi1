import { z } from 'zod'

// ── Work Order ──

export const createWorkOrderSchema = z.object({
  projectId: z.string().min(1, 'Dự án là bắt buộc'),
  workshopId: z.string().optional(),
  description: z.string().min(1, 'Mô tả là bắt buộc'),
  woType: z.enum(['INTERNAL', 'SUBCONTRACT']).default('INTERNAL'),
  teamCode: z.string().min(1, 'Mã tổ sản xuất là bắt buộc'),
  plannedStart: z.string().optional(),
  plannedEnd: z.string().optional(),
  quantity: z.number().positive().optional(),
})

export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>

export const updateWorkOrderSchema = z.object({
  workshopId: z.string().optional(),
  description: z.string().min(1).optional(),
  teamCode: z.string().optional(),
  status: z.string().optional(),
  plannedStart: z.string().optional(),
  plannedEnd: z.string().optional(),
  actualStart: z.string().optional(),
  actualEnd: z.string().optional(),
  quantity: z.number().positive().optional(),
  completedQty: z.number().min(0).optional(),
})

export type UpdateWorkOrderInput = z.infer<typeof updateWorkOrderSchema>

// ── Job Card ──

export const createJobCardSchema = z.object({
  workOrderId: z.string().min(1, 'Lệnh sản xuất là bắt buộc'),
  teamCode: z.string().min(1, 'Mã tổ là bắt buộc'),
  workType: z.string().min(1, 'Loại công việc là bắt buộc'),
  description: z.string().optional(),
  plannedQty: z.number().positive().optional(),
  unit: z.string().default('kg'),
  workDate: z.string().min(1, 'Ngày làm việc là bắt buộc'),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  manpower: z.number().int().positive().optional(),
  notes: z.string().optional(),
})

export type CreateJobCardInput = z.infer<typeof createJobCardSchema>

export const updateJobCardSchema = z.object({
  actualQty: z.number().min(0).optional(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  manpower: z.number().int().positive().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  notes: z.string().optional(),
})

export type UpdateJobCardInput = z.infer<typeof updateJobCardSchema>

// ── Material Issue ──

export const createMaterialIssueSchema = z.object({
  workOrderId: z.string().min(1, 'Lệnh sản xuất là bắt buộc'),
  materialId: z.string().min(1, 'Vật tư là bắt buộc'),
  quantity: z.number().positive('Số lượng phải > 0'),
  heatNumber: z.string().optional(),
  notes: z.string().optional(),
})

export type CreateMaterialIssueInput = z.infer<typeof createMaterialIssueSchema>

// ── Workshop ──

export const createWorkshopSchema = z.object({
  code: z.string().min(1, 'Mã xưởng là bắt buộc'),
  name: z.string().min(1, 'Tên xưởng là bắt buộc'),
  nameEn: z.string().optional().default(''),
  capacity: z.number().int().min(0).default(100),
})

export type CreateWorkshopInput = z.infer<typeof createWorkshopSchema>

// ── Delivery Record ──

export const createDeliverySchema = z.object({
  projectId: z.string().min(1, 'Dự án là bắt buộc'),
  workOrderId: z.string().optional(),
  shippingMethod: z.string().optional(),
  trackingNo: z.string().optional(),
  notes: z.string().optional(),
  packingList: z.unknown().optional(),
})

export type CreateDeliveryInput = z.infer<typeof createDeliverySchema>

export const updateDeliverySchema = z.object({
  status: z.enum(['PACKING', 'SHIPPED', 'DELIVERED', 'RECEIVED']).optional(),
  shippingMethod: z.string().optional(),
  trackingNo: z.string().optional(),
  receivedBy: z.string().optional(),
  notes: z.string().optional(),
})

export type UpdateDeliveryInput = z.infer<typeof updateDeliverySchema>
