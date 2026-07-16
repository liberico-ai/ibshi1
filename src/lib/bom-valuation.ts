// ══════════════════════════════════════════════════════════════
//  BOM Valuation — Gap #1
//  Định giá BOM vật tư của dự án → Budget.MATERIAL.planned, có coverage.
//
//  Đọc item BOM từ NHIỀU nguồn (vá gốc #1.1: luồng thật đẩy BOM vào PR /
//  Task.resultData chứ không phải bảng BillOfMaterial) rồi định giá phân
//  lớp, DỪNG ở lớp đầu tiên có giá. Trả coverage (định giá N/M dòng, X% KL)
//  để planned=0/thấp là có lý do NHÌN THẤY, không âm thầm.
//
//  KHÔNG viết matcher mới: tái dùng enrichBomPrItems (bọc matchInventoryServer
//  + canonicalCode strategy trong bompr-enrich.ts) cho lớp khớp Material Master.
//  KHÔNG viết fetch resultData mới: tái dùng fetchStepResult (data-fetchers.ts).
// ══════════════════════════════════════════════════════════════

import prisma from './db'
import { enrichBomPrItems } from './bompr-enrich'
import { fetchStepResult } from './data-fetchers'

// PR đã "CONVERTED"/"REJECTED"/"CANCELLED" không còn là nhu cầu sống — sao y create-po.
const PR_EXCLUDED_STATUSES = ['CONVERTED', 'REJECTED', 'CANCELLED']

export interface BomValuationResult {
  /** Σ qty × đơn giá(resolved), làm tròn về VND (integer). */
  planned: number
  /** Số dòng định giá được (đơn giá > 0). */
  pricedLines: number
  /** Số dòng KHÔNG định giá được (đơn giá = 0). */
  unpricedLines: number
  /** % khối lượng đã định giá (0-100, 1 chữ số thập phân). */
  pricedWeightPct: number
  /** Nguồn item đã dùng (để coverage nhìn thấy được đọc từ đâu). 'pr-items-net' = cơ sở NET (needToBuyQty, đã trừ tồn) chứ không phải gross. */
  source: 'bom-table' | 'task-resultData' | 'pr-items-net' | 'none'
}

// ── Item chuẩn hoá cho định giá ──
interface ValItem {
  quantity: number
  /** Cơ sở khối lượng để tính pricedWeightPct (kg nếu có, else = quantity). */
  weight: number
  materialId: string | null
  /** true nếu đã có đơn giá kèm theo (BOM item include material) → khỏi query lại. */
  hasInlinePrice: boolean
  materialUnitPrice: number
  itemCode: string | null
  description: string | null
  profile: string | null
  grade: string | null
  unit: string | null
  canonicalCode?: string
  // Trường phụ cho matcher (chỉ có ở nguồn resultData)
  thickness: number
  length: number
  width: number
  unitWeight: number
  weightKg: number
}

// ── Ép số an toàn (chấp nhận Decimal / "12,345.6" / number) ──
function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (v && typeof v === 'object' && 'toString' in v) {
    // Prisma.Decimal
    const n = Number((v as { toString(): string }).toString())
    if (Number.isFinite(n)) return n
  }
  if (typeof v === 'string') {
    const s = v.trim()
    if (s === '') return 0
    const cleaned = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) ? s.replace(/,/g, '') : s
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s === '' ? null : s
}

/** Khối lượng 1 dòng: ưu tiên weight (kg) → unitWeight×qty → quantity. */
function weightOf(quantity: number, weightKg: number, unitWeight: number): number {
  if (weightKg > 0) return weightKg
  if (unitWeight > 0) return unitWeight * quantity
  return quantity
}

// ══════════════════════════════════════════════════════
//  B1. Nguồn item (đọc cả 2 đường)
// ══════════════════════════════════════════════════════

/** Nguồn 1: BillOfMaterial APPROVED/RELEASED (item luôn có materialId + include material.unitPrice). */
async function loadFromBom(projectId: string): Promise<ValItem[]> {
  const boms = await prisma.billOfMaterial.findMany({
    where: { projectId, status: { in: ['APPROVED', 'RELEASED'] } },
    include: { items: { include: { material: true } } },
  })
  const out: ValItem[] = []
  for (const bom of boms) {
    for (const item of bom.items) {
      const quantity = num(item.quantity)
      out.push({
        quantity,
        weight: quantity, // BomItem không có KL riêng → quantity (thép: đơn vị kg)
        materialId: item.materialId ?? null,
        hasInlinePrice: true,
        materialUnitPrice: num(item.material?.unitPrice),
        itemCode: item.material?.materialCode ?? null,
        description: item.material?.name ?? null,
        profile: item.profile ?? null,
        grade: item.grade ?? null,
        unit: item.unit ?? null,
        thickness: 0, length: 0, width: 0, unitWeight: 0, weightKg: 0,
      })
    }
  }
  return out
}

/**
 * Nguồn 3 (fallback cuối): PurchaseRequestItem của dự án (PR còn sống) — sao y create-po fallback.
 * CẢNH BÁO NGỮ NGHĨA: quantity ở đây = needToBuyQty (ĐÃ trừ tồn kho) → là nhu cầu MUA (NET),
 * KHÔNG phải tổng vật tư gross. Chỉ dùng khi cả BOM lẫn resultData đều rỗng; source đánh dấu
 * 'pr-items-net' để planned thấp/thiếu hụt so với thực tế là NHÌN THẤY được, không âm thầm.
 */
async function loadFromPr(projectId: string): Promise<ValItem[]> {
  const rows = await prisma.purchaseRequestItem.findMany({
    where: { purchaseRequest: { projectId, status: { notIn: PR_EXCLUDED_STATUSES } } },
    select: {
      itemCode: true, description: true, profile: true, grade: true, unit: true,
      materialId: true, quantity: true,
    },
  })
  return rows.map(r => {
    const quantity = num(r.quantity)
    return {
      quantity,
      weight: quantity,
      materialId: r.materialId ?? null,
      hasInlinePrice: false,
      materialUnitPrice: 0,
      itemCode: r.itemCode ?? null,
      description: r.description ?? null,
      profile: r.profile ?? null,
      grade: r.grade ?? null,
      unit: r.unit ?? null,
      thickness: 0, length: 0, width: 0, unitWeight: 0, weightKg: 0,
    } as ValItem
  })
}

/**
 * Nguồn 2: BOM còn trong Task.resultData bước P2.1 (key bomPrItems, thường double-encoded).
 * quantity ở đây GIỮ gross + weight (kg) thật → là cơ sở ĐÚNG cho planned (tổng vật tư), ưu tiên
 * hơn PR (net). Đứng sau BillOfMaterial, trước PurchaseRequestItem.
 */
async function loadFromResultData(projectId: string): Promise<ValItem[]> {
  const p21 = await fetchStepResult(projectId, 'P2.1')
  const rd = (p21?.resultData as Record<string, unknown> | null) || null
  if (!rd) return []

  const raw = rd.bomPrItems
  let items: unknown[] = []
  if (Array.isArray(raw)) {
    items = raw
  } else if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const parsed = JSON.parse(raw)
      items = Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  const out: ValItem[] = []
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const quantity = num(o.quantity)
    const weightKg = num(o.weight)
    const unitWeight = num(o.unitWeight)
    if (quantity <= 0 && weightKg <= 0) continue
    out.push({
      quantity,
      weight: weightOf(quantity, weightKg, unitWeight),
      materialId: str(o.materialId),
      hasInlinePrice: false,
      materialUnitPrice: 0,
      itemCode: str(o.stt) ?? str(o.itemCode) ?? str(o.code),
      description: str(o.description) ?? str(o.name),
      profile: str(o.profile),
      grade: str(o.grade),
      unit: str(o.unit),
      canonicalCode: str(o.canonicalCode) ?? undefined,
      thickness: num(o.thickness),
      length: num(o.length),
      width: num(o.width),
      unitWeight,
      weightKg,
    })
  }
  return out
}

// ══════════════════════════════════════════════════════
//  B2. Đơn giá phân lớp — lớp 3 (báo giá / PO của dự án)
// ══════════════════════════════════════════════════════

const matKey = (id: string | null | undefined) => (id ? `mat:${id}` : null)
const codeKey = (s: string | null | undefined) => (s && s.trim() ? `code:${s.trim().toLowerCase()}` : null)
const descKey = (s: string | null | undefined) => (s && s.trim() ? `desc:${s.trim().toLowerCase()}` : null)

/** Bảng tra đơn giá từ PurchaseOrderItem của dự án (nguồn giá thật, bảng luôn tồn tại). */
async function loadProjectPriceMap(projectId: string): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  const add = (k: string | null, price: number) => {
    if (k && price > 0 && !map.has(k)) map.set(k, price)
  }

  const poItems = await prisma.purchaseOrderItem.findMany({
    where: { purchaseOrder: { projectId } },
    select: { materialId: true, itemCode: true, description: true, unitPrice: true },
  })
  for (const p of poItems) {
    const price = num(p.unitPrice)
    add(matKey(p.materialId), price)
    add(codeKey(p.itemCode), price)
    add(descKey(p.description), price)
  }

  // TODO: khi feature QuoteGroup (P2e) được WIRE vào route + migration
  // 20260707_quote_groups_tables được áp môi trường, thêm lại nguồn giá báo giá NCC
  // (QuoteGroupItem/SupplierQuoteLine) vào đây. Hiện feature dormant + bảng chưa tồn tại
  // trên UAT/prod → query sẽ ném "table does not exist" và chặn hook → CỐ TÌNH bỏ.

  return map
}

function lookupProjectPrice(
  pmap: Map<string, number>,
  materialId: string | null,
  itemCode: string | null,
  description: string | null,
): number {
  for (const k of [matKey(materialId), codeKey(itemCode), descKey(description)]) {
    if (k) {
      const p = pmap.get(k)
      if (p && p > 0) return p
    }
  }
  return 0
}

// ── Chuyển ValItem → PrItem shape cho enrichBomPrItems (chỉ dùng để lấy materialId khớp) ──
function toPrItem(it: ValItem) {
  return {
    stt: it.itemCode ?? '',
    description: it.description ?? '',
    profile: it.profile ?? '',
    grade: it.grade ?? '',
    unit: it.unit ?? '',
    quantity: it.quantity,
    weight: it.weightKg,
    unitWeight: it.unitWeight,
    thickness: it.thickness,
    length: it.length,
    width: it.width,
    ...(it.canonicalCode ? { canonicalCode: it.canonicalCode } : {}),
  }
}

// ══════════════════════════════════════════════════════
//  valueBomMaterial — điểm vào chính
// ══════════════════════════════════════════════════════

/**
 * Định giá BOM vật tư của dự án → { planned, pricedLines, unpricedLines, pricedWeightPct, source }.
 *
 * Nguồn item (dừng ở nguồn đầu có dữ liệu, ưu tiên GROSS = tổng vật tư để planned kiểm soát
 * đúng vs actual): BillOfMaterial(gross) → Task.resultData P2.1 bomPrItems(gross) →
 * PurchaseRequestItem(NET = needToBuyQty, chỉ khi 2 nguồn kia rỗng).
 * Đơn giá mỗi dòng (dừng ở lớp đầu có giá):
 *  1) material.unitPrice (materialId + giá > 0)
 *  2) khớp canonical/profile+grade → Material Master.unitPrice (qua enrichBomPrItems)
 *  3) đơn giá báo giá/PO của dự án (PurchaseOrderItem + QuoteGroupItem)
 *  4) 0 → đếm là "chưa định giá"
 *
 * Chỉ ĐỌC — không ghi bản ghi nào (enrichBomPrItems chạy matchOnly nên không tạo mã tạm).
 */
export async function valueBomMaterial(projectId: string): Promise<BomValuationResult> {
  // ── B1: chọn nguồn item ──
  let items = await loadFromBom(projectId)
  let source: BomValuationResult['source'] = 'bom-table'
  // GROSS trước (resultData giữ tổng vật tư + weight thật), NET (PR = needToBuyQty) chỉ là fallback cuối.
  if (items.length === 0) { items = await loadFromResultData(projectId); source = 'task-resultData' }
  if (items.length === 0) { items = await loadFromPr(projectId); source = 'pr-items-net' }
  if (items.length === 0) {
    return { planned: 0, pricedLines: 0, unpricedLines: 0, pricedWeightPct: 0, source: 'none' }
  }

  const prices = new Array<number>(items.length).fill(0)
  const resolvedMat: (string | null)[] = items.map(it => it.materialId)

  // ── Lớp 1: material.unitPrice ──
  // Dòng có sẵn đơn giá kèm (BOM include material) dùng thẳng; còn lại query 1 lượt theo materialId.
  const idsNeedingPrice = [
    ...new Set(items.filter(it => !it.hasInlinePrice && it.materialId).map(it => it.materialId as string)),
  ]
  const matPrice = new Map<string, number>()
  if (idsNeedingPrice.length > 0) {
    const mats = await prisma.material.findMany({
      where: { id: { in: idsNeedingPrice } },
      select: { id: true, unitPrice: true },
    })
    for (const m of mats) matPrice.set(m.id, num(m.unitPrice))
  }
  items.forEach((it, i) => {
    if (it.hasInlinePrice && it.materialUnitPrice > 0) prices[i] = it.materialUnitPrice
    else if (it.materialId && (matPrice.get(it.materialId) ?? 0) > 0) prices[i] = matPrice.get(it.materialId)!
  })

  // ── Lớp 2: khớp Material Master (chỉ dòng chưa có giá + chưa có materialId + có gì để khớp) ──
  const l2 = items
    .map((it, i) => ({ it, i }))
    .filter(({ it, i }) => prices[i] === 0 && !it.materialId && (it.profile || it.description || it.canonicalCode))
  if (l2.length > 0) {
    const enriched = await enrichBomPrItems(l2.map(({ it }) => toPrItem(it)), undefined, { matchOnly: true })
    const matchedIds = [...new Set(enriched.map(e => e.materialId).filter((x): x is string => !!x))]
    const l2price = new Map<string, number>()
    if (matchedIds.length > 0) {
      const mats = await prisma.material.findMany({
        where: { id: { in: matchedIds } },
        select: { id: true, unitPrice: true },
      })
      for (const m of mats) l2price.set(m.id, num(m.unitPrice))
    }
    enriched.forEach((e, k) => {
      const { i } = l2[k]
      if (e.materialId) {
        resolvedMat[i] = e.materialId
        const p = l2price.get(e.materialId) ?? 0
        if (p > 0) prices[i] = p
      }
    })
  }

  // ── Lớp 3: đơn giá báo giá / PO của dự án ──
  const l3 = items
    .map((it, i) => ({ it, i }))
    .filter(({ it, i }) => prices[i] === 0 && (resolvedMat[i] || it.itemCode || it.description))
  if (l3.length > 0) {
    const pmap = await loadProjectPriceMap(projectId)
    for (const { it, i } of l3) {
      const p = lookupProjectPrice(pmap, resolvedMat[i], it.itemCode, it.description)
      if (p > 0) prices[i] = p
    }
  }

  // ── B3: tổng hợp + coverage ──
  let planned = 0
  let pricedLines = 0
  let unpricedLines = 0
  let totalWeight = 0
  let pricedWeight = 0
  items.forEach((it, i) => {
    const w = it.weight > 0 ? it.weight : 0
    totalWeight += w
    if (prices[i] > 0) {
      planned += it.quantity * prices[i]
      pricedLines++
      pricedWeight += w
    } else {
      unpricedLines++
    }
  })
  const pricedWeightPct = totalWeight > 0 ? Math.round((pricedWeight / totalWeight) * 1000) / 10 : 0

  return {
    planned: Math.round(planned),
    pricedLines,
    unpricedLines,
    pricedWeightPct,
    source,
  }
}

/** Câu coverage ngắn để ghi vào Budget.notes / log — "Định giá N/M dòng (X% KL) [nguồn: ...]". */
export function formatCoverageNote(v: BomValuationResult): string {
  const total = v.pricedLines + v.unpricedLines
  const netFlag = v.source === 'pr-items-net' ? ' (net-cần mua)' : ''
  return `Định giá ${v.pricedLines}/${total} dòng (${v.pricedWeightPct}% KL) [nguồn: ${v.source}${netFlag}]`
}
