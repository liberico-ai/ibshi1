import { z } from 'zod'

// POST /api/materials — Create material (admin/warehouse)
export const createMaterialSchema = z.object({
  materialCode: z.string().min(1, 'Mã vật tư là bắt buộc'),
  name: z.string().min(1, 'Tên vật tư là bắt buộc'),
  nameEn: z.string().optional().default(''),
  unit: z.string().min(1, 'Đơn vị là bắt buộc'),
  category: z.string().min(1, 'Phân loại là bắt buộc'),
  specification: z.string().optional(),
  grade: z.string().optional(),
  minStock: z.number().min(0).default(0),
  unitPrice: z.number().min(0).optional(),
  currency: z.string().default('VND'),
})

export type CreateMaterialInput = z.infer<typeof createMaterialSchema>

// PATCH /api/materials/[id]
export const updateMaterialSchema = z.object({
  name: z.string().min(1).optional(),
  nameEn: z.string().optional(),
  unit: z.string().optional(),
  category: z.string().optional(),
  specification: z.string().optional(),
  grade: z.string().optional(),
  minStock: z.number().min(0).optional(),
  unitPrice: z.number().min(0).optional(),
  currency: z.string().optional(),
})

export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>

// POST /api/stock-movements — Record stock movement
export const stockMovementSchema = z.object({
  materialId: z.string().min(1, 'Vật tư là bắt buộc'),
  projectId: z.string().optional(),
  type: z.enum(['IN', 'OUT', 'RETURN', 'ADJUST']),
  quantity: z.number().positive('Số lượng phải > 0'),
  reason: z.string().min(1, 'Lý do là bắt buộc'),
  referenceNo: z.string().optional(),
  heatNumber: z.string().optional(),
  lotNumber: z.string().optional(),
  poItemId: z.string().optional(),
  notes: z.string().optional(),
})

export type StockMovementInput = z.infer<typeof stockMovementSchema>
