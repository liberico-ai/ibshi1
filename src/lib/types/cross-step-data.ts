// ══════════════════════════════════════════════════════════════
// Centralized Type Definitions for Cross-Step Data
// Single source of truth — ALL shared data structures live here.
// Changing a type here will cause tsc errors in ALL consumers.
// ══════════════════════════════════════════════════════════════

// ── BOM (Bill of Materials) ──────────────────────────────────

export interface BomEntry {
  name: string
  code: string
  spec: string
  quantity: string
  unit: string
}

export interface BomEntryWithSource extends BomEntry {
  source: 'P2.1' | 'P2.2' | 'P2.3'
}

// ── WBS (Work Breakdown Structure) ───────────────────────────

/** WbsRow is Record<string, string> because columns are dynamically imported from Excel */
export type WbsRow = Record<string, string>

export const WBS_BASE_KEYS = [
  'stt', 'hangMuc', 'dvt', 'khoiLuong', 'phamVi', 'thauPhu',
  'batDau', 'ketThuc', 'trangThai', 'khuVuc', 'ghiChu',
] as const

export const WBS_STAGE_KEYS = [
  'cutting', 'machining', 'fitup', 'welding', 'tryAssembly',
  'dismantle', 'blasting', 'painting', 'galvanize', 'insulation',
  'commissioning', 'khungKien', 'packing', 'delivery',
] as const

// ── Team Assignment / LSX ────────────────────────────────────

export interface TeamAssign {
  teamName: string
  volume?: string
  startDate: string
  endDate: string
  notes?: string
  rework_cloned?: boolean
}

export type CellAssignMap = Record<number, Record<string, TeamAssign[]>>

// Canonical: boolean (matches the actually-used inline WbsTableUI in page.tsx line 46).
// The separate WbsTableUI.tsx uses {status, details} — if that file replaces the inline
// version in the future, update this type.
export type LsxIssuedMap = Record<number, Record<string, Record<number, boolean>>>

// ── Material Request ─────────────────────────────────────────

export interface MaterialReqItem {
  name: string
  code?: string
  spec: string
  quantity?: string
  qty?: string          // Legacy alias for quantity (used in some WbsTableUI paths)
  unit?: string
  status?: string
  requested?: boolean
}

export type MaterialReqMap = Record<number, Record<string, Record<number, MaterialReqItem[]>>>

// ── MOM (Minutes of Meeting) ─────────────────────────────────

export interface MomItem {
  stt: string
  noiDung: string
  actionBy: string
  dueDate: string
  remark: string
}

export interface MomSection {
  key: string
  title: string
  items: MomItem[]
}

export interface MomAttendant {
  name: string
  role: string
}

// ── Estimate (DT02-DT07) ─────────────────────────────────────

export interface Dt02Row {
  maCP: string
  noiDung: string
  giaTri: string
  tyLe: string
}

export interface Dt03Row {
  nhomVT: string
  danhMuc: string
  dvt: string
  kl: string
  donGia: string
  thanhTien: string
}

/** Generic row for DT05/DT06/DT07 — similar structure with minor field differences */
export interface DtGenericRow {
  maCP: string
  noiDung?: string
  danhMuc?: string
  dvt: string
  kl: string
  donGia: string
  thanhTien: string
}

export interface EstimateTotals {
  totalMaterial: string | number
  totalLabor: string | number
  totalService?: string | number
  totalOverhead?: string | number
  totalEstimate: string | number
  estimateFileName?: string
  dt02Detail?: Array<{ maCP: string; noiDung: string; giaTri: number }>
}

// ── Supplier / PO ────────────────────────────────────────────

export interface SupplierQuote {
  material: string
  price: string
}

export interface SupplierEntry {
  name: string
  quotes: SupplierQuote[]
}

export interface PoData {
  poNumber?: string
  totalAmount?: string
  paymentType?: 'full' | 'partial'
  paymentMilestones?: Array<{
    label: string
    percent: string
    date: string
  }>
}

// ── Work Order / Job Card ────────────────────────────────────

export interface WoItem {
  costCode: string
  content: string
  jobCode: string
  typeCode: string
  unit: string
  qty1: string
  qty2: string
  totalQty: string
  startDate: string
  endDate: string
}

export interface JobCardStage {
  hangMuc: string
  volume: string
  unit: string
  team: string
}

// ── QC ───────────────────────────────────────────────────────

export interface QcItem {
  task: string
  result: string
}

// ── Attached Files ───────────────────────────────────────────

// route.ts gets Date from Prisma, page.tsx receives string after JSON serialization.
// Use string | Date to support both sides of the serialization boundary.
export interface PrevStepFile {
  stepCode: string
  stepName: string
  files: Array<{
    id: string
    fileName: string
    fileUrl: string
    fileSize: number | null
    mimeType: string | null
    createdAt: string | Date
  }>
}

// ══════════════════════════════════════════════════════════════
// PreviousStepData — Per-step typed interfaces
// These replace the `{ plan?: any; estimate?: any; ... }` union
// ══════════════════════════════════════════════════════════════

export interface PrevDataP13 {
  plan: { wbsItems?: string; momSections?: string; momAttendants?: string;[k: string]: unknown } | null
  estimate: (EstimateTotals & { dt02Items?: Dt02Row[]; dt03Items?: Dt03Row[] } & Record<string, unknown>) | null
}

export interface PrevDataP23 {
  bom: ({ bomItems?: BomEntry[] } & Record<string, unknown>) | null
  estimate: (EstimateTotals & Record<string, unknown>) | null
}

export interface PrevDataP24 {
  bomMain: ({ bomItems?: BomEntry[] } & Record<string, unknown>) | null
  bomWeldPaint: ({ bomItems?: BomEntry[] } & Record<string, unknown>) | null
  bomSupply: ({ bomItems?: BomEntry[] } & Record<string, unknown>) | null
  estimate: (EstimateTotals & Record<string, unknown>) | null
}

export interface PrevDataP25 extends PrevDataP24 {
  plan: Record<string, unknown> | null
}

export interface PrevDataP31 {
  plan: ({ wbsItems?: string } & Record<string, unknown>) | null
}

export interface PrevDataP32 {
  prItems: BomEntryWithSource[]
  fromStock: Array<BomEntryWithSource & { requestedQty: number; inStock: number; matchedMaterial: unknown }>
  toPurchase: Array<BomEntryWithSource & { requestedQty: number; inStock: number; shortfall: number; specMatch: boolean; matchedMaterial: unknown }>
}

export interface PrevDataP33P34 {
  plan: ({ wbsItems?: string } & Record<string, unknown>) | null
  bomItems: BomEntryWithSource[]
}

export interface PrevDataP35 {
  prItems: BomEntryWithSource[]
}

export interface PrevDataP36 {
  supplierData: ({ suppliers?: SupplierEntry[] } & Record<string, unknown>) | null
  estimate: (EstimateTotals & Record<string, unknown>) | null
}

export interface PrevDataP37 {
  supplierData: ({ suppliers?: SupplierEntry[] } & Record<string, unknown>) | null
}

export interface PrevDataP41 {
  poData: (PoData & Record<string, unknown>) | null
}

export interface PrevDataP42 {
  poData: (PoData & Record<string, unknown>) | null
  supplierData: ({ suppliers?: SupplierEntry[] } & Record<string, unknown>) | null
}

export interface PrevDataP43 extends PrevDataP42 {}

export interface PrevDataP44 {
  qcData: ({ inspectionResult?: string; qcItems?: QcItem[] } & Record<string, unknown>) | null
  supplierData: Record<string, unknown> | null
  prItems: BomEntryWithSource[]
}

export interface PrevDataP45 {
  lsxData: Record<string, unknown> | null
  woData: ({ woItems?: WoItem[] } & Record<string, unknown>) | null
  inventory: Array<{ code: string; name: string; spec: string; stock: number; unit: string; category: string }>
}

export interface PrevDataP52 {
  jobCardData: Record<string, unknown> | null
}

export interface PrevDataP54 {
  jobCardData: Record<string, unknown> | null
  volumeData: Record<string, unknown> | null
}

export interface PrevDataP62 {
  budgetTotal: number    // Computed as Number(rd.totalEstimate || 0) in route.ts
}

export interface PrevDataP65 {
  p61Status: string
  p62Status: string
  p62Total: unknown
  p62Variance: unknown
  p63Status: string
  p63Profit: unknown
  p63Margin: unknown
  p64Status: string
}

/**
 * Map from stepCode to its previousStepData type.
 * Use for type narrowing: `const prev = previousStepData as PreviousStepDataMap['P1.3']`
 *
 * NOTE: `departmentEstimates` exists in page.tsx state (line 1344) but is never
 * sent from route.ts. It's omitted here — remove from page.tsx state when confirmed unused.
 */
export type PreviousStepDataMap = {
  'P1.3': PrevDataP13
  'P2.3': PrevDataP23
  'P2.4': PrevDataP24
  'P2.5': PrevDataP25
  'P3.1': PrevDataP31
  'P3.2': PrevDataP32
  'P3.3': PrevDataP33P34
  'P3.4': PrevDataP33P34
  'P3.5': PrevDataP35
  'P3.6': PrevDataP36
  'P3.7': PrevDataP37
  'P4.1': PrevDataP41
  'P4.2': PrevDataP42
  'P4.3': PrevDataP43
  'P4.4': PrevDataP44
  'P4.5': PrevDataP45
  'P5.2': PrevDataP52
  'P5.4': PrevDataP54
  'P6.2': PrevDataP62
  'P6.5': PrevDataP65
}
