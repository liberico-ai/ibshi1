import { z } from 'zod'

// ── Invoice ──

export const createInvoiceSchema = z.object({
  projectId: z.string().optional(),
  vendorId: z.string().optional(),
  type: z.enum(['RECEIVABLE', 'PAYABLE']),
  clientName: z.string().optional(),
  description: z.string().optional(),
  amount: z.number().positive('Số tiền phải > 0'),
  taxRate: z.number().min(0).max(100).default(10),
  taxAmount: z.number().min(0).optional(),
  totalAmount: z.number().positive('Tổng tiền phải > 0'),
  currency: z.string().default('VND'),
  issueDate: z.string().optional(),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
})

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>

export const updateInvoiceSchema = z.object({
  description: z.string().optional(),
  amount: z.number().positive().optional(),
  taxRate: z.number().min(0).max(100).optional(),
  taxAmount: z.number().min(0).optional(),
  totalAmount: z.number().positive().optional(),
  dueDate: z.string().optional(),
  status: z.enum(['DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED']).optional(),
  notes: z.string().optional(),
})

export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>

// ── Payment ──

export const createPaymentSchema = z.object({
  invoiceId: z.string().min(1, 'Hóa đơn là bắt buộc'),
  amount: z.number().positive('Số tiền phải > 0'),
  paymentDate: z.string().min(1, 'Ngày thanh toán là bắt buộc'),
  method: z.enum(['BANK_TRANSFER', 'CASH', 'CHECK']).default('BANK_TRANSFER'),
  reference: z.string().optional(),
  notes: z.string().optional(),
})

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>

// ── Budget ──

export const createBudgetSchema = z.object({
  projectId: z.string().min(1, 'Dự án là bắt buộc'),
  category: z.enum(['MATERIAL', 'LABOR', 'EQUIPMENT', 'SUBCONTRACT', 'OVERHEAD']),
  planned: z.number().min(0).default(0),
  actual: z.number().min(0).default(0),
  committed: z.number().min(0).default(0),
  forecast: z.number().min(0).default(0),
  month: z.number().int().min(1).max(12).optional(),
  year: z.number().int().min(2020).max(2100).optional(),
  notes: z.string().optional(),
})

export type CreateBudgetInput = z.infer<typeof createBudgetSchema>

export const updateBudgetSchema = z.object({
  planned: z.number().min(0).optional(),
  actual: z.number().min(0).optional(),
  committed: z.number().min(0).optional(),
  forecast: z.number().min(0).optional(),
  notes: z.string().optional(),
})

export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>

// ── Cashflow Entry ──

export const createCashflowSchema = z.object({
  projectId: z.string().optional(),
  type: z.enum(['INFLOW', 'OUTFLOW']),
  category: z.enum(['REVENUE', 'MATERIAL_COST', 'LABOR', 'EQUIPMENT', 'OVERHEAD', 'TAX', 'OTHER']),
  amount: z.number().positive('Số tiền phải > 0'),
  description: z.string().optional(),
  entryDate: z.string().min(1, 'Ngày là bắt buộc'),
  reference: z.string().optional(),
})

export type CreateCashflowInput = z.infer<typeof createCashflowSchema>

export const updateCashflowSchema = z.object({
  amount: z.number().positive().optional(),
  description: z.string().optional(),
  reference: z.string().optional(),
  status: z.enum(['RECORDED', 'VERIFIED', 'RECONCILED']).optional(),
})

export type UpdateCashflowInput = z.infer<typeof updateCashflowSchema>
