import prisma from './db'
import { MR_STATUS } from './material-request-constants'

// Vật tư của một lệnh sản xuất (WO): đề nghị cấp ↔ đã cấp ↔ còn thiếu.
//
// Trước đây hệ chỉ có MaterialIssue ("đã cấp"), nên Kho không biết một WO cần bao nhiêu.
// WorkOrderMaterialRequest bù chỗ đó; hai bảng đối chiếu theo (workOrderId, materialId).

export interface WoMaterialLine {
  materialId: string
  materialCode: string
  name: string
  specification: string | null
  unit: string
  requested: number
  issued: number
  remaining: number
  currentStock: number
  source: string
}

/**
 * Danh sách vật tư của WO kèm số đã cấp, còn thiếu và tồn kho hiện tại.
 * Mặc định CHỈ tính phiếu ĐÃ DUYỆT (dùng cho Kho). Truyền requestId để lấy đúng một phiếu
 * (dùng cho màn xưởng đang lập/sửa).
 */
export async function buildWoMaterialLines(
  workOrderId: string, opts?: { requestId?: string },
): Promise<WoMaterialLine[]> {
  const scope = opts?.requestId
    ? { requestId: opts.requestId }
    : { request: { status: MR_STATUS.APPROVED } }
  const [reqs, issued] = await Promise.all([
    prisma.workOrderMaterialRequest.findMany({
      where: { workOrderId, ...scope },
      include: { material: { select: { materialCode: true, name: true, specification: true, unit: true, currentStock: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.materialIssue.groupBy({ by: ['materialId'], where: { workOrderId }, _sum: { quantity: true } }),
  ])
  const issuedBy = new Map(issued.map(i => [i.materialId, Number(i._sum.quantity || 0)]))

  return reqs.map((r) => {
    const requested = Number(r.quantity)
    const done = issuedBy.get(r.materialId) || 0
    return {
      materialId: r.materialId,
      materialCode: r.material.materialCode,
      name: r.material.name,
      specification: r.material.specification,
      unit: r.unit || r.material.unit,
      requested,
      issued: done,
      remaining: Math.max(0, requested - done),
      currentStock: Number(r.material.currentStock),
      source: r.source,
    }
  })
}

/** WO đã cấp đủ mọi dòng đề nghị chưa. WO không có đề nghị nào → coi như CHƯA đủ (chưa lập danh mục). */
export async function isWoMaterialFulfilled(workOrderId: string): Promise<boolean> {
  const lines = await buildWoMaterialLines(workOrderId)
  if (lines.length === 0) return false
  return lines.every((l) => l.issued >= l.requested)
}

// ── Quyền lập đề nghị: XƯỞNG tự lo vật tư cho lệnh của mình ──
// PM chỉ phát hành WO; BGĐ/Admin không lập hộ (chốt nghiệp vụ 2026-08).
export const WO_MATERIAL_REQUEST_ROLES = ['R06', 'R06a', 'R06b']

/**
 * Xưởng của user có được đụng vào WO này không.
 *
 * GIAI ĐOẠN 1 — CHỈ XƯỞNG NỘI BỘ: WO phải gắn đúng xưởng của tài khoản.
 * WO giao thầu phụ làm ngoài (không gắn xưởng, teamCode = THAUPHU) NẰM NGOÀI luồng này —
 * chờ chốt hướng xử lý riêng. Khi chốt, sửa đúng hàm này là cả danh sách lẫn quyền đề nghị
 * vật tư đổi theo (hai nơi dùng chung).
 */
export function canWorkshopEditWo(userDepartmentId: string | null, wo: { departmentId: string | null }): boolean {
  if (!wo.departmentId) return false
  return !!userDepartmentId && wo.departmentId === userDepartmentId
}

export interface RequestItemInput { materialId: string; quantity: number; unit?: string; source?: string; notes?: string | null }

/** Gộp trùng mã + bỏ dòng không hợp lệ. Mỗi WO chỉ 1 dòng cho mỗi mã vật tư. */
export function normalizeRequestItems(items: unknown[]): RequestItemInput[] {
  const byMaterial = new Map<string, RequestItemInput>()
  for (const raw of items as Record<string, unknown>[]) {
    const materialId = String(raw?.materialId || '').trim()
    const quantity = Number(raw?.quantity)
    if (!materialId || !Number.isFinite(quantity) || quantity <= 0) continue
    const prev = byMaterial.get(materialId)
    byMaterial.set(materialId, {
      materialId,
      quantity: (prev?.quantity || 0) + quantity,
      unit: String(raw?.unit || prev?.unit || '').trim() || 'kg',
      source: raw?.source === 'BOM' ? 'BOM' : (prev?.source || 'MANUAL'),
      notes: raw?.notes ? String(raw.notes).trim() : (prev?.notes ?? null),
    })
  }
  return [...byMaterial.values()]
}

// ── Trạng thái phiếu đề nghị cấp vật tư ──
// Hằng số trạng thái phiếu tách sang material-request-constants.ts (client dùng chung, không kéo prisma)
export { MR_STATUS_LABEL, MR_EDITABLE } from './material-request-constants'
export { MR_STATUS }

/** Mã phiếu: MR-<mã dự án>-<số thứ tự 3 chữ số trong dự án>. */
export async function nextMaterialRequestCode(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { projectCode: true } })
  const n = await prisma.materialRequestOrder.count({ where: { projectId } })
  return `MR-${project?.projectCode || 'NA'}-${String(n + 1).padStart(3, '0')}`
}

/**
 * Đặt lại danh mục đề nghị của một WO TRONG MỘT PHIẾU (thay thế, không cộng dồn).
 * Chặn bỏ/hạ dòng đã cấp một phần — số đã xuất kho phải luôn có đề nghị đối chiếu.
 * Trả về lỗi dạng chuỗi (null = OK) để route tự dựng errorResponse.
 */
export async function setWoMaterialRequests(
  requestId: string, workOrderId: string, items: RequestItemInput[], userId: string,
): Promise<string | null> {
  const issued = await prisma.materialIssue.groupBy({
    by: ['materialId'], where: { workOrderId }, _sum: { quantity: true },
  })
  const wanted = new Map(items.map(i => [i.materialId, i]))
  for (const row of issued) {
    const done = Number(row._sum.quantity || 0)
    if (done <= 0) continue
    const keep = wanted.get(row.materialId)
    const m = await prisma.material.findUnique({ where: { id: row.materialId }, select: { materialCode: true } })
    if (!keep) return `Vật tư ${m?.materialCode || row.materialId} đã cấp ${done} — không bỏ khỏi danh sách được`
    if (keep.quantity < done) return `Vật tư ${m?.materialCode || row.materialId}: đã cấp ${done}, không đặt đề nghị thấp hơn`
  }

  const keepIds = items.map(i => i.materialId)
  await prisma.$transaction([
    prisma.workOrderMaterialRequest.deleteMany({
      where: { requestId, workOrderId, ...(keepIds.length ? { materialId: { notIn: keepIds } } : {}) },
    }),
    ...items.map(i =>
      prisma.workOrderMaterialRequest.upsert({
        where: { requestId_workOrderId_materialId: { requestId, workOrderId, materialId: i.materialId } },
        create: { requestId, workOrderId, materialId: i.materialId, quantity: i.quantity, unit: i.unit || 'kg', source: i.source || 'MANUAL', notes: i.notes ?? null, createdBy: userId },
        update: { quantity: i.quantity, unit: i.unit || 'kg', source: i.source || 'MANUAL', notes: i.notes ?? null },
      }),
    ),
  ])
  return null
}

export interface BomSuggestion {
  materialId: string
  materialCode: string
  name: string
  specification: string | null
  unit: string
  quantity: number
  currentStock: number
}

/**
 * Gợi ý vật tư cho WO từ BOM theo piece-mark.
 * WO mang pieceMark (sinh từ ô WBS) và có thể mang bomVersionId; nếu không có version thì lấy
 * bản ACTIVE mới nhất của dự án. Không có piece-mark hoặc không khớp dòng nào → trả mảng rỗng,
 * PM vẫn tự thêm tay được.
 */
export async function suggestBomMaterialsForWo(wo: {
  id: string; pieceMark: string | null; projectId: string; bomVersionId: string | null
}): Promise<BomSuggestion[]> {
  if (!wo.pieceMark) return []

  let bomVersionId = wo.bomVersionId
  if (!bomVersionId) {
    const active = await prisma.bomVersion.findFirst({
      where: { status: 'ACTIVE', bom: { projectId: wo.projectId } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    bomVersionId = active?.id ?? null
  }
  if (!bomVersionId) return []

  // pieceMark của WO dạng "U1 / MLI1652" — BOM ghi mã trần, nên so khớp phần sau dấu "/".
  const mark = wo.pieceMark.includes('/') ? wo.pieceMark.split('/').pop()!.trim() : wo.pieceMark.trim()

  const items = await prisma.bomItem.findMany({
    where: { bomVersionId, pieceMark: { equals: mark, mode: 'insensitive' } },
    include: { material: { select: { materialCode: true, name: true, specification: true, unit: true, currentStock: true } } },
    orderBy: { sortOrder: 'asc' },
  })

  // Gộp trùng mã trong cùng piece-mark
  const merged = new Map<string, BomSuggestion>()
  for (const it of items) {
    const prev = merged.get(it.materialId)
    const qty = Number(it.quantity) + (prev?.quantity || 0)
    merged.set(it.materialId, {
      materialId: it.materialId,
      materialCode: it.material.materialCode,
      name: it.material.name,
      specification: it.material.specification,
      unit: it.unit || it.material.unit,
      quantity: qty,
      currentStock: Number(it.material.currentStock),
    })
  }
  return [...merged.values()]
}
