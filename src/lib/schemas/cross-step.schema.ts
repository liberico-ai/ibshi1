import { z } from 'zod'
import type {
  BomEntry,
  EstimateTotals,
  Dt02Row,
  Dt03Row,
  SupplierEntry,
  SupplierQuote,
  WoItem,
  MomItem,
  MomSection,
  QcItem,
  MaterialReqItem,
} from '@/lib/types'

// ══════════════════════════════════════════════════════════════
// Cross-Step Zod Schemas — runtime validation for shared data
// Mirrors interfaces in src/lib/types/cross-step-data.ts
// ══════════════════════════════════════════════════════════════

// ── BOM (Bill of Materials) ──────────────────────────────────

export const bomEntrySchema = z.object({
  name: z.string(),
  code: z.string().optional().default(''),
  spec: z.string().optional().default(''),
  quantity: z.string(),
  unit: z.string(),
}) satisfies z.ZodType<BomEntry>

export type BomEntrySchema = z.infer<typeof bomEntrySchema>

// ── Estimate (DT02/DT03) ────────────────────────────────────

const stringOrNumber = z.union([z.string(), z.number()])

export const estimateTotalsSchema = z.object({
  totalMaterial: stringOrNumber,
  totalLabor: stringOrNumber,
  totalService: stringOrNumber.optional(),
  totalOverhead: stringOrNumber.optional(),
  totalEstimate: stringOrNumber,
  estimateFileName: z.string().optional(),
  dt02Detail: z
    .array(
      z.object({
        maCP: z.string(),
        noiDung: z.string(),
        giaTri: z.number(),
      })
    )
    .optional(),
}) satisfies z.ZodType<EstimateTotals>

export type EstimateTotalsSchema = z.infer<typeof estimateTotalsSchema>

export const dt02RowSchema = z.object({
  maCP: z.string(),
  noiDung: z.string(),
  giaTri: z.string(),
  tyLe: z.string(),
}) satisfies z.ZodType<Dt02Row>

export type Dt02RowSchema = z.infer<typeof dt02RowSchema>

export const dt03RowSchema = z.object({
  nhomVT: z.string(),
  danhMuc: z.string(),
  dvt: z.string(),
  kl: z.string(),
  donGia: z.string(),
  thanhTien: z.string(),
}) satisfies z.ZodType<Dt03Row>

export type Dt03RowSchema = z.infer<typeof dt03RowSchema>

// ── Supplier / PO ────────────────────────────────────────────

export const supplierQuoteSchema = z.object({
  material: z.string(),
  price: z.string(),
}) satisfies z.ZodType<SupplierQuote>

export const supplierEntrySchema = z.object({
  name: z.string(),
  quotes: z.array(supplierQuoteSchema),
}) satisfies z.ZodType<SupplierEntry>

export type SupplierEntrySchema = z.infer<typeof supplierEntrySchema>

// ── Work Order ───────────────────────────────────────────────

export const woItemSchema = z.object({
  costCode: z.string(),
  content: z.string(),
  jobCode: z.string(),
  typeCode: z.string(),
  unit: z.string(),
  qty1: z.string(),
  qty2: z.string(),
  totalQty: z.string(),
  startDate: z.string(),
  endDate: z.string(),
}) satisfies z.ZodType<WoItem>

export type WoItemSchema = z.infer<typeof woItemSchema>

// ── MOM (Minutes of Meeting) ─────────────────────────────────

export const momItemSchema = z.object({
  stt: z.string(),
  noiDung: z.string(),
  actionBy: z.string(),
  dueDate: z.string(),
  remark: z.string(),
}) satisfies z.ZodType<MomItem>

export type MomItemSchema = z.infer<typeof momItemSchema>

export const momSectionSchema = z.object({
  key: z.string(),
  title: z.string(),
  items: z.array(momItemSchema),
}) satisfies z.ZodType<MomSection>

export type MomSectionSchema = z.infer<typeof momSectionSchema>

// ── QC ───────────────────────────────────────────────────────

export const qcItemSchema = z.object({
  task: z.string(),
  result: z.string(),
}) satisfies z.ZodType<QcItem>

export type QcItemSchema = z.infer<typeof qcItemSchema>

// ── Material Request ─────────────────────────────────────────

export const materialReqItemSchema = z.object({
  name: z.string(),
  code: z.string().optional(),
  spec: z.string(),
  quantity: z.string().optional(),
  qty: z.string().optional(),
  unit: z.string().optional(),
  status: z.string().optional(),
  requested: z.boolean().optional(),
}) satisfies z.ZodType<MaterialReqItem>

export type MaterialReqItemSchema = z.infer<typeof materialReqItemSchema>

// ══════════════════════════════════════════════════════════════
// Safe Parser Helpers
// Return typed data or null — never throw
// ══════════════════════════════════════════════════════════════

/**
 * Safely parse an unknown value as BomEntry[].
 * Handles both raw arrays and JSON strings.
 */
export function safeParseBomItems(data: unknown): BomEntry[] | null {
  const input = typeof data === 'string' ? tryParseJson(data) : data
  const result = z.array(bomEntrySchema).safeParse(input)
  return result.success ? result.data : null
}

/**
 * Safely parse an unknown value as EstimateTotals.
 * Handles both raw objects and JSON strings.
 */
export function safeParseEstimate(data: unknown): EstimateTotals | null {
  const input = typeof data === 'string' ? tryParseJson(data) : data
  const result = estimateTotalsSchema.safeParse(input)
  return result.success ? result.data : null
}

/**
 * Safely parse an unknown value as SupplierEntry[].
 * Handles both raw arrays and JSON strings.
 */
export function safeParseSuppliers(data: unknown): SupplierEntry[] | null {
  const input = typeof data === 'string' ? tryParseJson(data) : data
  const result = z.array(supplierEntrySchema).safeParse(input)
  return result.success ? result.data : null
}

// ── Internal helper ──────────────────────────────────────────

function tryParseJson(str: string): unknown {
  try {
    return JSON.parse(str)
  } catch {
    return undefined
  }
}
