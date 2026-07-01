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
  status: z.enum(['ACTIVE', 'ARCHIVE', 'OBSOLETE']).optional(),
  isProvisional: z.boolean().optional(), // duyệt mã tạm: set false
})

export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>

// GET /api/materials — list/search query
export const materialQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  q: z.string().optional(),                 // tìm theo tên / mã chuẩn / alias
  category: z.string().optional(),
  status: z.enum(['ACTIVE', 'ARCHIVE', 'OBSOLETE']).optional(),
  provisional: z.enum(['true', 'false']).optional(), // lọc mã tạm chờ duyệt
})

export type MaterialQueryInput = z.infer<typeof materialQuerySchema>

// POST /api/materials/[id]/aliases — add an old code as alias
export const addAliasSchema = z.object({
  aliasCode: z.string().min(1, 'Mã bí danh là bắt buộc').transform((s) => s.trim()),
  source: z.enum(['KHO', 'KETOAN', 'LEGACY_DOT', 'TK', 'TM', 'MANUAL']).default('MANUAL'),
  note: z.string().optional(),
})

export type AddAliasInput = z.infer<typeof addAliasSchema>

// POST /api/materials/resolve-batch — resolve many codes at once (PR upload)
export const resolveBatchSchema = z.object({
  codes: z.array(z.string()).min(1, 'Cần ít nhất 1 mã').max(2000),
})

export type ResolveBatchInput = z.infer<typeof resolveBatchSchema>

// POST /api/materials/quick-create — auto-generate provisional code (PR flow)
export const quickCreateMaterialSchema = z.object({
  name: z.string().min(1, 'Tên vật tư là bắt buộc'),
  specification: z.string().optional(),
  unit: z.string().min(1, 'Đơn vị là bắt buộc'),
  prefix: z.string().min(1, 'Nhóm vật tư là bắt buộc').transform((s) => s.trim().toUpperCase()),
  subgroup: z.string().min(1, 'Phân nhóm là bắt buộc').max(8).transform((s) => s.trim().toUpperCase()),
  // bắt buộc đã qua bước tra trùng (dedupe gate) ở UI trước khi cho tạo mới
  confirmedNotDuplicate: z.literal(true),
  estimatedUnitPrice: z.number().min(0).optional(),
  createdByUnit: z.string().optional(),
})

export type QuickCreateMaterialInput = z.infer<typeof quickCreateMaterialSchema>

// POST /api/materials/merge — merge duplicate codes into one survivor
export const mergeMaterialsSchema = z.object({
  survivorId: z.string().min(1, 'Thiếu mã giữ lại'),
  duplicateIds: z.array(z.string().min(1)).min(1, 'Cần ít nhất 1 mã trùng để gộp'),
})

export type MergeMaterialsInput = z.infer<typeof mergeMaterialsSchema>

// POST /api/materials/promote — Promote provisional code to canonical
export const promoteMaterialSchema = z.object({
  provisionalId: z.string().min(1, 'Thiếu mã tạm'),
  targetId: z.string().optional(),
  newCode: z.string().optional(),
}).refine(
  (d) => d.targetId || d.newCode,
  { message: 'Cần chọn mã đích (targetId) hoặc tạo mã mới (newCode)' },
)

export type PromoteMaterialInput = z.infer<typeof promoteMaterialSchema>

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
