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
  teamCode: z.string().optional(),
  workType: z.string().min(1, 'Loại công việc là bắt buộc'),
  description: z.string().optional(),
  plannedQty: z.number().positive().optional(),
  actualQty: z.number().min(0).optional(),
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

// ── Weld Joint ──

export const createWeldJointSchema = z.object({
  workOrderId: z.string().min(1),
  jointNo: z.string().min(1),
  jointType: z.enum(['BUTT', 'FILLET', 'LAP', 'TEE', 'CORNER']).default('BUTT'),
  wpsNo: z.string().optional(),
  welderId: z.string().optional(),
  welderCertId: z.string().optional(),
  diameter: z.number().positive().optional(),
  thickness: z.number().positive().optional(),
  length: z.number().positive().optional(),
  remarks: z.string().optional(),
})
export type CreateWeldJointInput = z.infer<typeof createWeldJointSchema>

export const updateWeldJointSchema = z.object({
  status: z.enum(['PENDING', 'WELDED', 'REPAIRED']).optional(),
  wpsNo: z.string().optional(),
  welderId: z.string().optional(),
  welderCertId: z.string().optional(),
  ndtStatus: z.enum(['PENDING', 'PASSED', 'FAILED']).optional(),
  ndtMethod: z.string().optional(),
  ncrId: z.string().optional(),
  remarks: z.string().optional(),
})
export type UpdateWeldJointInput = z.infer<typeof updateWeldJointSchema>

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

// ── Packing List ──

export const createPackingListSchema = z.object({
  projectId: z.string().min(1),
  dimensions: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(z.object({
    workOrderId: z.string().min(1),
    pieceMark: z.string().min(1),
    description: z.string().optional(),
    weight: z.number().positive().optional(),
    quantity: z.number().int().positive().default(1),
  })).min(1, 'Cần ít nhất 1 piece-mark'),
})
export type CreatePackingListInput = z.infer<typeof createPackingListSchema>

// ── Shipment ──

export const createShipmentSchema = z.object({
  projectId: z.string().min(1),
  vehicleNo: z.string().optional(),
  driverName: z.string().optional(),
  driverPhone: z.string().optional(),
  destination: z.string().optional(),
  notes: z.string().optional(),
  packingListIds: z.array(z.string().min(1)).min(1, 'Cần ít nhất 1 kiện'),
})
export type CreateShipmentInput = z.infer<typeof createShipmentSchema>

export const updateShipmentSchema = z.object({
  status: z.enum(['PENDING', 'IN_TRANSIT', 'ARRIVED', 'RECEIVED']).optional(),
  vehicleNo: z.string().optional(),
  driverName: z.string().optional(),
  driverPhone: z.string().optional(),
  destination: z.string().optional(),
  receivedBy: z.string().optional(),
  notes: z.string().optional(),
})
export type UpdateShipmentInput = z.infer<typeof updateShipmentSchema>
