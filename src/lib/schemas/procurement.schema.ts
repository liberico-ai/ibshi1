import { z } from 'zod'

// ── Purchase Request ──

const purchaseRequestItemSchema = z.object({
  materialId: z.string().min(1, 'Vật tư là bắt buộc'),
  quantity: z.number().positive('Số lượng phải > 0'),
  requiredDate: z.string().optional(),
  specification: z.string().optional(),
  notes: z.string().optional(),
})

export const createPurchaseRequestSchema = z.object({
  projectId: z.string().min(1, 'Dự án là bắt buộc'),
  urgency: z.enum(['NORMAL', 'URGENT', 'CRITICAL']).default('NORMAL'),
  notes: z.string().optional(),
  items: z.array(purchaseRequestItemSchema).min(1, 'Cần ít nhất 1 vật tư'),
})

export type CreatePurchaseRequestInput = z.infer<typeof createPurchaseRequestSchema>

// ── Purchase Order ──

const purchaseOrderItemSchema = z.object({
  materialId: z.string().min(1, 'Vật tư là bắt buộc'),
  quantity: z.number().positive('Số lượng phải > 0'),
  unitPrice: z.number().min(0, 'Đơn giá phải >= 0'),
  notes: z.string().optional(),
})

export const createPurchaseOrderSchema = z.object({
  vendorId: z.string().min(1, 'Nhà cung cấp là bắt buộc'),
  currency: z.string().default('VND'),
  orderDate: z.string().optional(),
  deliveryDate: z.string().optional(),
  paymentTerms: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(purchaseOrderItemSchema).min(1, 'Cần ít nhất 1 mặt hàng'),
})

export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>

// POST /api/purchase-orders/convert — Convert PR items to PO
export const convertPrToPoSchema = z.object({
  prId: z.string().min(1, 'PR ID là bắt buộc'),
  vendorId: z.string().min(1, 'Nhà cung cấp là bắt buộc'),
  items: z.array(z.object({
    materialId: z.string().min(1),
    quantity: z.number().positive(),
    unitPrice: z.number().min(0),
  })).min(1, 'Cần ít nhất 1 mặt hàng'),
})

export type ConvertPrToPoInput = z.infer<typeof convertPrToPoSchema>

// ── GRN (Goods Receipt) ──

const grnItemSchema = z.object({
  poItemId: z.string().min(1),
  receivedQty: z.number().positive('Số lượng nhận phải > 0'),
  heatNumber: z.string().optional(),
  lotNumber: z.string().optional(),
  notes: z.string().optional(),
})

export const createGrnSchema = z.object({
  poId: z.string().min(1, 'PO là bắt buộc'),
  items: z.array(grnItemSchema).min(1, 'Cần ít nhất 1 mặt hàng'),
  notes: z.string().optional(),
})

export type CreateGrnInput = z.infer<typeof createGrnSchema>

// ── Vendor ──

export const createVendorSchema = z.object({
  vendorCode: z.string().min(1, 'Mã NCC là bắt buộc'),
  name: z.string().min(1, 'Tên NCC là bắt buộc'),
  contactName: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  country: z.string().default('VN'),
  category: z.string().min(1, 'Phân loại là bắt buộc'),
  notes: z.string().optional(),
})

export type CreateVendorInput = z.infer<typeof createVendorSchema>

export const updateVendorSchema = z.object({
  name: z.string().min(1).optional(),
  contactName: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  country: z.string().optional(),
  category: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional(),
})

export type UpdateVendorInput = z.infer<typeof updateVendorSchema>
