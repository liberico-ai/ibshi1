import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import {
  authenticateRequest, successResponse, errorResponse,
  unauthorizedResponse, requireRoles,
} from '@/lib/auth'
import { validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'
import { toQty } from '@/lib/pr-normalizer'
import { fetchPoCoverageMap, coverageKey } from '@/lib/pr-coverage'
import { nextPoCode } from '@/lib/po-code'

const ALLOWED_ROLES = ['R01', 'R02', 'R02a', 'R07', 'R07a']

// PR đã "CONVERTED" (đã ra PO) / "REJECTED" / "CANCELLED" → KHÔNG lấy làm nguồn mua,
// tránh đặt mua trùng. Chỉ lấy PR còn "sống" (DRAFT/SUBMITTED/PENDING/APPROVED…).
const PR_EXCLUDED_STATUSES = ['CONVERTED', 'REJECTED', 'CANCELLED']

type PoItem = {
  itemCode: string; materialId: string | null; description: string; profile: string; grade: string;
  unit: string; quantity: number; unitPrice: number;
}

/** Chuẩn hoá khoá tra giá: trim + hạ chữ thường. Rỗng → null. */
function priceKey(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  return s === '' ? null : s
}

/**
 * Bảng tra đơn giá từ các dòng báo giá của NCC đã chọn — keyed theo code + description.
 * Dùng cho nhánh dự phòng (nguồn PR) để gắn đơn giá khi báo giá có dòng khớp;
 * không khớp → đơn giá 0 (giống luồng convert PR→PO, người sửa giá sau).
 */
function buildPriceMap(
  quoteLines: Array<{ code?: string; description?: string; unitPrice?: number }>,
): Map<string, number> {
  const map = new Map<string, number>()
  for (const line of quoteLines) {
    const price = typeof line.unitPrice === 'number' && Number.isFinite(line.unitPrice) ? line.unitPrice : 0
    for (const k of [priceKey(line.code), priceKey(line.description)]) {
      if (k && !map.has(k)) map.set(k, price)
    }
  }
  return map
}

/**
 * Build PO item từ dòng PurchaseRequestItem đã materialize của dự án.
 * quantity đã là "số cần mua" (normalizer ưu tiên needToBuyQty khi materialize).
 * Bỏ dòng quantity <= 0. Đơn giá tra từ báo giá NCC (nếu khớp), không có → 0.
 *
 * CHỐNG MUA TRÙNG (coverage per-item): nếu truyền `coverage`, mỗi dòng bị TRỪ phần
 * đã được PO khác của dự án phủ (gom theo materialId, loại PO DRAFT/CANCELLED/REJECTED).
 * Chỉ đưa vào PO phần CÒN LẠI = quantity − đã phủ (> 0). Phủ hết → bỏ dòng.
 * GIỚI HẠN: coverage tra theo materialId. Dòng snapshot materialId=null KHÔNG có dữ
 * liệu coverage → giữ hành vi cũ (đề nghị FULL quantity) — rủi ro mua trùng còn tồn
 * với các dòng không link vật tư kho.
 */
function buildPoItemsFromPr(
  prItems: Array<{
    itemCode?: string | null; description?: string | null; profile?: string | null;
    grade?: string | null; unit?: string | null; materialId?: string | null; quantity: unknown;
  }>,
  priceMap: Map<string, number>,
  coverage?: { projectId: string; map: Map<string, number> },
): PoItem[] {
  const out: PoItem[] = []
  for (const it of prItems) {
    // quantity là Prisma Decimal (object) → String() rồi toQty; toQty(Decimal) thẳng sẽ ra 0.
    const quantity = toQty(String(it.quantity ?? ''))
    if (quantity <= 0) continue

    // Trừ phần đã phủ (chỉ khi có materialId để tra coverage).
    let remaining = quantity
    const materialId = it.materialId || null
    if (materialId && coverage) {
      const key = coverageKey(coverage.projectId, materialId)
      const covered = coverage.map.get(key) || 0
      // min(): nhiều dòng PR cùng mã → tiêu hao dần coverage, không trừ trùng.
      const consumed = Math.min(quantity, covered)
      remaining = quantity - consumed
      coverage.map.set(key, covered - consumed) // giảm coverage còn lại cho dòng sau
      if (remaining <= 0) continue // đã phủ hết → không tạo dòng
    }

    const unitPrice =
      priceMap.get(priceKey(it.itemCode) ?? '') ??
      priceMap.get(priceKey(it.description) ?? '') ??
      0
    out.push({
      itemCode: it.itemCode || '',
      materialId,
      description: it.description || '',
      profile: it.profile || '',
      grade: it.grade || '',
      unit: it.unit || '',
      quantity: remaining,
      unitPrice,
    })
  }
  return out
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ALLOWED_ROLES)) {
    return errorResponse('Không có quyền tạo PO', 403)
  }

  const pResult = validateParams(await params, idParamSchema)
  if (!pResult.success) return pResult.response
  const { id: taskId } = pResult.data

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true, projectId: true, createdBy: true, resultData: true,
      assignees: { select: { userId: true } },
    },
  })
  if (!task) return errorResponse('Không tìm thấy task', 404)

  const isAssignee = task.assignees.some(a => a.userId === user.userId)
  if (!isAssignee && task.createdBy !== user.userId) {
    return errorResponse('Bạn không liên quan đến task này', 403)
  }

  const rd = (task.resultData && typeof task.resultData === 'object')
    ? (task.resultData as Record<string, unknown>) : {}

  // Idempotent: already created
  if (rd.poId && typeof rd.poId === 'string') {
    const existing = await prisma.purchaseOrder.findUnique({ where: { id: rd.poId } })
    if (existing) {
      return successResponse({ poId: existing.id, poCode: existing.poCode, existing: true })
    }
  }

  // Validate chosen vendor
  const chosenVendorId = typeof rd.chosenVendorId === 'string' ? rd.chosenVendorId : null
  if (!chosenVendorId) return errorResponse('Chưa chọn NCC (chosenVendorId)', 400)

  const vendor = await prisma.vendor.findUnique({ where: { id: chosenVendorId } })
  if (!vendor) return errorResponse('NCC không tồn tại', 404)

  // Parse quotes + bomPr
  const quotes = Array.isArray(rd.supplierQuotes)
    ? (rd.supplierQuotes as Array<{ vendorId?: string; lines?: Array<{ matchedPrIndex?: number | null; unitPrice?: number; code?: string; description?: string; profile?: string; grade?: string; unit?: string; qty?: number }> ; paymentTerms?: string }>)
    : []
  const chosenQuote = quotes.find(q => q.vendorId === chosenVendorId)
  const quoteLines = chosenQuote?.lines ?? []

  const bomPr = typeof rd.bomPr === 'string' ? (() => { try { return JSON.parse(rd.bomPr) } catch { return null } })() : null
  const prItems: Array<{ stt?: string; canonicalCode?: string; materialId?: string; description?: string; profile?: string; grade?: string; unit?: string; needToBuyQty?: number }> =
    Array.isArray(bomPr) ? bomPr : []

  // Build PO items (đường CHÍNH): chỉ dòng báo giá khớp PR-index trong bomPr với needToBuyQty > 0
  const poItems: PoItem[] = []

  for (const line of quoteLines) {
    if (line.matchedPrIndex == null) continue
    const prItem = prItems[line.matchedPrIndex]
    if (!prItem) continue
    // BUG CŨ: `typeof needToBuyQty === 'number'` → dòng lưu số dạng CHUỖI ({"needToBuyQty":"1"})
    // bị coi là 0 và BỎ QUA IM LẶNG → vật tư không bao giờ được đặt mua mà không ai biết.
    const needToBuy = toQty(prItem.needToBuyQty)
    if (needToBuy <= 0) continue

    poItems.push({
      itemCode: prItem.stt || line.code || '',
      materialId: prItem.materialId || null,
      description: prItem.description || line.description || '',
      profile: prItem.profile || line.profile || '',
      grade: prItem.grade || line.grade || '',
      unit: prItem.unit || line.unit || '',
      quantity: needToBuy,
      unitPrice: line.unitPrice ?? 0,
    })
  }

  // FALLBACK (HƯỚNG A) — gỡ deadlock P3.5→PO:
  // Ở P3.5 (Thương mại) task KHÔNG có `bomPr` (R07 không ghi được → đường chính rỗng).
  // Nhu cầu mua THẬT đã materialize ở bảng PurchaseRequest/PurchaseRequestItem của DỰ ÁN.
  // → lấy dòng cần mua từ đó khi đường chính không dựng được item nào.
  if (poItems.length === 0 && task.projectId) {
    const prRows = await prisma.purchaseRequestItem.findMany({
      where: {
        purchaseRequest: {
          projectId: task.projectId,
          status: { notIn: PR_EXCLUDED_STATUSES },
        },
      },
      select: {
        itemCode: true, description: true, profile: true, grade: true, unit: true,
        materialId: true, quantity: true,
      },
      orderBy: { purchaseRequest: { createdAt: 'asc' } },
    })
    // Coverage per-item: gom số đã được PO khác của dự án phủ (theo materialId), để
    // TRỪ khỏi nhu cầu mua → tránh đề nghị mua lại phần đã có PO. Chỉ tra được item
    // có materialId; item snapshot (materialId=null) không có dữ liệu → giữ full.
    const materialIds = Array.from(
      new Set(prRows.map(r => r.materialId).filter((m): m is string => !!m)),
    )
    const coverageMap = await fetchPoCoverageMap([task.projectId], materialIds)

    const priceMap = buildPriceMap(quoteLines)
    poItems.push(
      ...buildPoItemsFromPr(prRows, priceMap, { projectId: task.projectId, map: coverageMap }),
    )
  }

  if (poItems.length === 0) {
    return errorResponse('Không có vật tư cần mua (đủ kho hoặc chưa có yêu cầu mua)', 400)
  }

  const totalValue = poItems.reduce((s, it) => s + it.quantity * it.unitPrice, 0)

  // Generate PO code
  const poCode = await nextPoCode()

  const po = await prisma.purchaseOrder.create({
    data: {
      poCode,
      vendorId: chosenVendorId,
      projectId: task.projectId,
      status: 'DRAFT',
      currency: 'VND',
      paymentTerms: chosenQuote?.paymentTerms || null,
      orderDate: new Date(),
      createdBy: user.userId,
      sourceTaskId: taskId,
      totalValue: Math.round(totalValue),
      items: {
        create: poItems.map(it => ({
          materialId: it.materialId,
          itemCode: it.itemCode,
          description: it.description,
          profile: it.profile,
          grade: it.grade,
          unit: it.unit,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
        })),
      },
    },
  })

  // Save poId/poCode to resultData (atomic merge)
  const patch = JSON.stringify({ poId: po.id, poCode: po.poCode })
  await prisma.$executeRaw`
    UPDATE "tasks"
    SET "result_data" = COALESCE("result_data", '{}'::jsonb) || ${patch}::jsonb,
        "updated_at" = now()
    WHERE "id" = ${taskId}`

  return successResponse({ poId: po.id, poCode: po.poCode })
}
