import { z } from 'zod'

// ── Drawing ──

export const createDrawingSchema = z.object({
  projectId: z.string().min(1, 'Dự án là bắt buộc'),
  title: z.string().min(1, 'Tiêu đề là bắt buộc'),
  discipline: z.string().min(1, 'Loại bản vẽ là bắt buộc'),
})

export type CreateDrawingInput = z.infer<typeof createDrawingSchema>

export const updateDrawingSchema = z.object({
  title: z.string().min(1).optional(),
  discipline: z.string().optional(),
  status: z.enum(['IFR', 'IFC', 'AFC']).optional(),
  checkedBy: z.string().optional(),
  approvedBy: z.string().optional(),
  fileUrl: z.string().optional(),
})

export type UpdateDrawingInput = z.infer<typeof updateDrawingSchema>

// Drawing revision
export const createDrawingRevisionSchema = z.object({
  drawingId: z.string().min(1, 'Bản vẽ là bắt buộc'),
  revision: z.string().min(1, 'Số revision là bắt buộc'),
  description: z.string().optional(),
  issuedDate: z.string().min(1, 'Ngày phát hành là bắt buộc'),
  fileUrl: z.string().optional(),
})

export type CreateDrawingRevisionInput = z.infer<typeof createDrawingRevisionSchema>

// Drawing status transition
export const drawingTransitionSchema = z.object({
  action: z.enum(['IFR_TO_IFC', 'IFC_TO_AFC']),
})

export type DrawingTransitionInput = z.infer<typeof drawingTransitionSchema>

// ── BOM (Bill of Material) ──

const bomItemSchema = z.object({
  materialId: z.string().min(1, 'Vật tư là bắt buộc'),
  quantity: z.number().positive('Số lượng phải > 0'),
  unit: z.string().min(1, 'Đơn vị là bắt buộc'),
  remarks: z.string().optional(),
})

export const createBomSchema = z.object({
  projectId: z.string().min(1, 'Dự án là bắt buộc'),
  name: z.string().min(1, 'Tên BOM là bắt buộc'),
  items: z.array(bomItemSchema).optional(),
})

export type CreateBomInput = z.infer<typeof createBomSchema>

export const updateBomSchema = z.object({
  name: z.string().min(1).optional(),
  revision: z.string().optional(),
  status: z.enum(['DRAFT', 'APPROVED', 'RELEASED']).optional(),
})

export type UpdateBomInput = z.infer<typeof updateBomSchema>

// ── ECO (Engineering Change Order) ──

export const createEcoSchema = z.object({
  projectId: z.string().min(1, 'Dự án là bắt buộc'),
  title: z.string().min(1, 'Tiêu đề là bắt buộc'),
  description: z.string().min(1, 'Mô tả là bắt buộc'),
  changeType: z.string().min(1, 'Loại thay đổi là bắt buộc'),
  impactCost: z.number().optional(),
  impactSchedule: z.number().int().optional(),
})

export type CreateEcoInput = z.infer<typeof createEcoSchema>

export const updateEcoSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  changeType: z.string().optional(),
  impactCost: z.number().optional(),
  impactSchedule: z.number().int().optional(),
  status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'IMPLEMENTED']).optional(),
})

export type UpdateEcoInput = z.infer<typeof updateEcoSchema>
