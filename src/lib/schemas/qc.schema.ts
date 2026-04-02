import { z } from 'zod'
import { searchFilterSchema } from './common.schema'

// ── Inspection ──

export const inspectionListQuerySchema = searchFilterSchema.extend({
  projectId: z.string().optional(),
  type: z.string().optional(),
})

export type InspectionListQuery = z.infer<typeof inspectionListQuerySchema>

const checklistItemSchema = z.object({
  checkItem: z.string().min(1, 'Mục kiểm tra là bắt buộc'),
  standard: z.string().optional(),
})

export const createInspectionSchema = z.object({
  inspectionCode: z.string().min(1, 'Mã biên bản là bắt buộc'),
  projectId: z.string().min(1, 'Dự án là bắt buộc'),
  type: z.string().min(1, 'Loại kiểm tra là bắt buộc'),
  stepCode: z.string().min(1, 'Bước workflow là bắt buộc'),
  checklistItems: z.array(checklistItemSchema).optional().default([]),
})

export type CreateInspectionInput = z.infer<typeof createInspectionSchema>

// PATCH /api/qc/[id] — Update inspection result
export const updateInspectionSchema = z.object({
  status: z.enum(['PENDING', 'PASSED', 'FAILED', 'CONDITIONAL']).optional(),
  remarks: z.string().optional(),
  resultData: z.record(z.string(), z.unknown()).optional(),
})

export type UpdateInspectionInput = z.infer<typeof updateInspectionSchema>

// ── ITP (Inspection Test Plan) ──

const itpCheckpointSchema = z.object({
  checkpointNo: z.number().int().positive(),
  activity: z.string().min(1, 'Hoạt động là bắt buộc'),
  description: z.string().min(1, 'Mô tả là bắt buộc'),
  standard: z.string().optional(),
  acceptCriteria: z.string().optional(),
  inspectionType: z.enum(['HOLD', 'WITNESS', 'MONITOR', 'REVIEW']).default('MONITOR'),
})

export const createItpSchema = z.object({
  projectId: z.string().min(1, 'Dự án là bắt buộc'),
  name: z.string().min(1, 'Tên ITP là bắt buộc'),
  revision: z.string().default('R0'),
  checkpoints: z.array(itpCheckpointSchema).optional().default([]),
})

export type CreateItpInput = z.infer<typeof createItpSchema>

// ── NCR (Non-Conformance Report) ──

export const createNcrSchema = z.object({
  projectId: z.string().min(1, 'Dự án là bắt buộc'),
  category: z.string().min(1, 'Phân loại là bắt buộc'),
  severity: z.enum(['MINOR', 'MAJOR', 'CRITICAL']).default('MINOR'),
  description: z.string().min(1, 'Mô tả là bắt buộc'),
  rootCause: z.string().optional(),
  disposition: z.string().optional(),
})

export type CreateNcrInput = z.infer<typeof createNcrSchema>

export const updateNcrSchema = z.object({
  rootCause: z.string().optional(),
  disposition: z.enum(['USE_AS_IS', 'REWORK', 'REJECT', 'RETURN_TO_VENDOR']).optional(),
  status: z.enum(['OPEN', 'INVESTIGATING', 'ACTION_TAKEN', 'CLOSED', 'CANCELLED']).optional(),
})

export type UpdateNcrInput = z.infer<typeof updateNcrSchema>

// NCR Action
export const createNcrActionSchema = z.object({
  ncrId: z.string().min(1, 'NCR là bắt buộc'),
  actionType: z.enum(['corrective', 'preventive', 'containment']),
  description: z.string().min(1, 'Mô tả là bắt buộc'),
  assignedTo: z.string().min(1, 'Người phụ trách là bắt buộc'),
  dueDate: z.string().optional(),
})

export type CreateNcrActionInput = z.infer<typeof createNcrActionSchema>

// ── Certificate Registry ──

export const createCertificateSchema = z.object({
  certType: z.string().min(1, 'Loại chứng chỉ là bắt buộc'),
  certNumber: z.string().min(1, 'Số chứng chỉ là bắt buộc'),
  holderName: z.string().min(1, 'Tên người/thiết bị là bắt buộc'),
  holderId: z.string().optional(),
  issuedBy: z.string().min(1, 'Đơn vị cấp là bắt buộc'),
  issueDate: z.string().min(1, 'Ngày cấp là bắt buộc'),
  expiryDate: z.string().min(1, 'Ngày hết hạn là bắt buộc'),
  standard: z.string().optional(),
  scope: z.string().optional(),
  fileUrl: z.string().optional(),
})

export type CreateCertificateInput = z.infer<typeof createCertificateSchema>

// ── Mill Certificate ──

export const createMillCertSchema = z.object({
  certNumber: z.string().min(1, 'Số chứng chỉ là bắt buộc'),
  materialId: z.string().min(1, 'Vật tư là bắt buộc'),
  vendorId: z.string().min(1, 'Nhà cung cấp là bắt buộc'),
  heatNumber: z.string().min(1, 'Heat number là bắt buộc'),
  grade: z.string().optional(),
  thickness: z.string().optional(),
  chemComposition: z.record(z.string(), z.unknown()).optional(),
  mechProperties: z.record(z.string(), z.unknown()).optional(),
  fileUrl: z.string().optional(),
})

export type CreateMillCertInput = z.infer<typeof createMillCertSchema>
