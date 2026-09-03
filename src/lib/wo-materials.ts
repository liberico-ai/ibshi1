import prisma from './db'
import { MR_STATUS, WORKSHOP_MATERIAL_ROLES, isSubcontractWo } from './material-request-constants'

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
export { WO_MATERIAL_REQUEST_ROLES, WORKSHOP_MATERIAL_ROLES, PM_MATERIAL_ROLES, isSubcontractWo, SUBCONTRACT_TEAM_CODE } from './material-request-constants'

export interface MaterialRequestActor {
  roleCode: string
  /** Phòng của tài khoản (User.departmentId) */
  departmentId: string | null
  /** Có phải PM phụ trách CHÍNH dự án của lệnh này không */
  isProjectPm: boolean
}

export type WoForMaterialPerm = {
  departmentId: string | null
  woType?: string | null
  teamCode?: string | null
}

/**
 * Ai được lập đề nghị vật tư cho một lệnh.
 *
 *   • Lệnh GIAO THẦU PHỤ  → PM phụ trách dự án (BGĐ/Admin hỗ trợ). Lệnh làm ngoài không
 *     thuộc xưởng nào, không ai trong xưởng đứng ra lo được.
 *   • Lệnh của XƯỞNG      → đúng xưởng của tài khoản, như cũ.
 *   • Lệnh nội bộ CHƯA GẮN XƯỞNG → không ai, vì không biết là của xưởng nào. Đây là lỗi
 *     dữ liệu; sửa bằng cách gắn xưởng cho lệnh, không phải nới quyền.
 */
export function canRequestMaterialForWo(actor: MaterialRequestActor, wo: WoForMaterialPerm): boolean {
  if (isSubcontractWo(wo)) {
    return actor.isProjectPm || ['R01', 'R10'].includes(actor.roleCode)
  }
  if (!wo.departmentId) return false
  if (!WORKSHOP_MATERIAL_ROLES.includes(actor.roleCode)) return false
  return !!actor.departmentId && wo.departmentId === actor.departmentId
}

/** Vì sao không lập được — để API trả câu người đọc hiểu thay vì '403'. */
export function whyCannotRequestMaterial(actor: MaterialRequestActor, wo: WoForMaterialPerm & { woCode: string }): string {
  if (isSubcontractWo(wo)) return `${wo.woCode} là lệnh giao thầu phụ — chỉ PM phụ trách dự án lập được đề nghị vật tư`
  if (!wo.departmentId) return `${wo.woCode} chưa gắn xưởng — PM cần gán xưởng cho lệnh trước khi đề nghị vật tư`
  return `${wo.woCode} không thuộc xưởng của bạn`
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

// ─────────────────────────────────────────────────────────────────────────────
// Tóm tắt tình trạng vật tư cho NHIỀU lệnh cùng lúc — dùng cho cột "Vật tư" ở danh sách SX.
//
// Vì sao cần: từ khi cổng vật tư không còn chặn "Bắt đầu SX", trạng thái WO chuyển sang
// "Đang chạy" là mất dấu vết đã cấp hay chưa. Cột này giữ tín hiệu đó suốt vòng đời lệnh.
//
// Gọi buildWoMaterialLines cho từng lệnh sẽ tốn 2 truy vấn × số dòng trong trang, nên
// gộp lại còn ĐÚNG 2 truy vấn cho cả trang.
// ─────────────────────────────────────────────────────────────────────────────

export interface WoMaterialSummary {
  /** số dòng vật tư đã duyệt của lệnh */
  total: number
  /** số dòng đã cấp đủ (cấp ≥ yêu cầu) */
  done: number
  /** 'NONE' chưa cấp gì · 'PARTIAL' cấp một phần · 'FULL' đủ cả · null chưa có danh mục */
  state: 'NONE' | 'PARTIAL' | 'FULL' | null
}

export async function summarizeWoMaterials(
  workOrderIds: string[],
): Promise<Map<string, WoMaterialSummary>> {
  const out = new Map<string, WoMaterialSummary>()
  if (workOrderIds.length === 0) return out

  const [reqs, issues] = await Promise.all([
    prisma.workOrderMaterialRequest.groupBy({
      by: ['workOrderId', 'materialId'],
      where: { workOrderId: { in: workOrderIds }, request: { status: MR_STATUS.APPROVED } },
      _sum: { quantity: true },
    }),
    prisma.materialIssue.groupBy({
      by: ['workOrderId', 'materialId'],
      where: { workOrderId: { in: workOrderIds } },
      _sum: { quantity: true },
    }),
  ])

  const issuedBy = new Map<string, number>()
  for (const i of issues) {
    if (!i.workOrderId || !i.materialId) continue
    issuedBy.set(`${i.workOrderId}|${i.materialId}`, Number(i._sum.quantity) || 0)
  }

  for (const r of reqs) {
    const cur = out.get(r.workOrderId) || { total: 0, done: 0, state: null as WoMaterialSummary['state'] }
    const need = Number(r._sum.quantity) || 0
    const got = issuedBy.get(`${r.workOrderId}|${r.materialId}`) || 0
    cur.total++
    if (got >= need) cur.done++
    out.set(r.workOrderId, cur)
  }

  for (const [, s] of out) {
    s.state = s.total === 0 ? null : s.done === 0 ? 'NONE' : s.done < s.total ? 'PARTIAL' : 'FULL'
  }
  return out
}
