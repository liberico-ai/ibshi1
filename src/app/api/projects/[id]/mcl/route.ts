import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'
import {
  aggregateMcl,
  normCode,
  MCL_PO_EXCLUDED_STATUSES,
  type MclDemandItem,
  type MclPoItem,
  type MclMaterialQty,
} from '@/lib/mcl'

export const dynamic = 'force-dynamic'

// Cùng nhóm role xem mua sắm/kho như /api/grn, /api/procurement-tracking
const MCL_ROLES = ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R05', 'R05a', 'R07', 'R07a', 'R08', 'R08a']

// PR không tính vào "Cần" (đã huỷ / bị từ chối)
const PR_EXCLUDED_STATUSES = ['CANCELLED', 'REJECTED']
// Kho tái sử dụng (dùng chung được cho mọi dự án)
const REUSABLE_KINDS = new Set(['COMMON', 'RETURN'])

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, MCL_ROLES)) {
      return errorResponse('Không có quyền xem bảng kiểm soát vật tư', 403)
    }

    const pResult = validateParams(await params, idParamSchema)
    if (!pResult.success) return pResult.response
    const projectId = pResult.data.id

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, projectCode: true, projectName: true },
    })
    if (!project) return errorResponse('Dự án không tồn tại', 404)

    // ── 1. Cần (PR) ──
    const prItemsRaw = await prisma.purchaseRequestItem.findMany({
      where: {
        purchaseRequest: { projectId, status: { notIn: PR_EXCLUDED_STATUSES } },
      },
      select: {
        materialId: true, itemCode: true, description: true, profile: true, grade: true,
        unit: true, quantity: true,
        material: { select: { materialCode: true, name: true, unit: true } },
      },
    })

    // ── 2. Cần (BOM ACTIVE — fallback) ──
    const bomItemsRaw = await loadActiveBomItems(projectId)

    // ── 3. Đã đặt / Đã về (PO hợp lệ) ──
    const poItemsRaw = await prisma.purchaseOrderItem.findMany({
      where: {
        purchaseOrder: { projectId, status: { notIn: MCL_PO_EXCLUDED_STATUSES } },
      },
      select: {
        materialId: true, itemCode: true, description: true, profile: true, grade: true,
        unit: true, quantity: true, receivedQty: true,
        material: { select: { materialCode: true, name: true, unit: true } },
      },
    })

    // ── Chuẩn hoá sang input hàm gộp + dựng codeToMaterialId ──
    const codeToMaterialId = new Map<string, string>()
    const regCode = (code: string | null | undefined, materialId: string | null | undefined) => {
      if (!materialId) return
      const c = normCode(code)
      if (c && !codeToMaterialId.has(c)) codeToMaterialId.set(c, materialId)
    }

    const prItems: MclDemandItem[] = prItemsRaw.map(it => {
      regCode(it.itemCode, it.materialId)
      regCode(it.material?.materialCode, it.materialId)
      return {
        materialId: it.materialId,
        itemCode: it.itemCode,
        description: it.description,
        profile: it.profile,
        grade: it.grade,
        unit: it.unit,
        materialCode: it.material?.materialCode ?? null,
        materialName: it.material?.name ?? null,
        quantity: Number(it.quantity) || 0,
      }
    })

    const bomItems: MclDemandItem[] = bomItemsRaw.map(it => {
      regCode(it.materialCode, it.materialId)
      return it
    })

    const poItems: MclPoItem[] = poItemsRaw.map(it => {
      regCode(it.itemCode, it.materialId)
      regCode(it.material?.materialCode, it.materialId)
      return {
        materialId: it.materialId,
        itemCode: it.itemCode,
        description: it.description,
        profile: it.profile,
        grade: it.grade,
        unit: it.unit,
        materialCode: it.material?.materialCode ?? null,
        materialName: it.material?.name ?? null,
        ordered: Number(it.quantity) || 0,
        received: Number(it.receivedQty) || 0,
      }
    })

    // Tập materialId liên quan (để truy tồn kho + đã cấp)
    const materialIds = new Set<string>()
    for (const it of prItems) if (it.materialId) materialIds.add(it.materialId)
    for (const it of bomItems) if (it.materialId) materialIds.add(it.materialId)
    for (const it of poItems) if (it.materialId) materialIds.add(it.materialId)
    const materialIdList = [...materialIds]

    // ── 4. Tồn (MaterialStock — kho tái sử dụng + kho của dự án) ──
    const stocks: MclMaterialQty[] = []
    if (materialIdList.length > 0) {
      const stockRows = await prisma.materialStock.findMany({
        where: { materialId: { in: materialIdList }, quantity: { gt: 0 } },
        select: {
          materialId: true,
          quantity: true,
          material: { select: { materialCode: true, name: true, unit: true } },
          warehouse: { select: { kind: true, projectCode: true } },
        },
      })
      for (const s of stockRows) {
        const kind = s.warehouse?.kind || 'OTHER'
        const isReusable = REUSABLE_KINDS.has(kind)
        const isThisProject = kind === 'PROJECT' && s.warehouse?.projectCode === project.projectCode
        if (!isReusable && !isThisProject) continue
        stocks.push({
          materialId: s.materialId,
          materialCode: s.material?.materialCode ?? null,
          materialName: s.material?.name ?? null,
          unit: s.material?.unit ?? null,
          quantity: Number(s.quantity) || 0,
        })
      }
    }

    // ── 5. Đã cấp (MaterialIssue qua WorkOrder của dự án) ──
    const issueRows = await prisma.materialIssue.findMany({
      where: { workOrder: { projectId } },
      select: {
        materialId: true,
        quantity: true,
        material: { select: { materialCode: true, name: true, unit: true } },
      },
    })
    const issues: MclMaterialQty[] = issueRows.map(is => ({
      materialId: is.materialId,
      materialCode: is.material?.materialCode ?? null,
      materialName: is.material?.name ?? null,
      unit: is.material?.unit ?? null,
      quantity: Number(is.quantity) || 0,
    }))

    // ── Gộp ──
    const rows = aggregateMcl({ prItems, bomItems, poItems, stocks, issues, codeToMaterialId })

    const summary = {
      totalRows: rows.length,
      shortageRows: rows.filter(r => r.shortage > 0).length,
      totalNeeded: round3(rows.reduce((s, r) => s + r.needed, 0)),
      totalOrdered: round3(rows.reduce((s, r) => s + r.ordered, 0)),
      totalReceived: round3(rows.reduce((s, r) => s + r.received, 0)),
      totalShortage: round3(rows.reduce((s, r) => s + r.shortage, 0)),
    }

    const res = successResponse({ project, rows, summary })
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    return res
  } catch (error) {
    console.error('projects/[id]/mcl GET ERROR:', error)
    return errorResponse('Lỗi hệ thống khi tải bảng kiểm soát vật tư', 500)
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/**
 * Đọc các dòng BOM của BomVersion ACTIVE (mọi category) — chỉ để làm nguồn "Cần" fallback.
 * Trả về dạng MclDemandItem đã chuẩn hoá. Không có BOM structured → [].
 */
async function loadActiveBomItems(projectId: string): Promise<MclDemandItem[]> {
  const bom = await prisma.billOfMaterial.findFirst({
    where: { projectId },
    select: { id: true },
  })
  if (!bom) return []
  const activeVersion = await prisma.bomVersion.findFirst({
    where: { bomId: bom.id, status: 'ACTIVE' },
    select: { id: true },
  })
  if (!activeVersion) return []

  const lines = await prisma.bomItem.findMany({
    where: { bomVersionId: activeVersion.id },
    select: {
      materialId: true, quantity: true, unit: true, profile: true, grade: true,
      material: { select: { materialCode: true, name: true, unit: true } },
    },
  })

  return lines.map(l => ({
    materialId: l.materialId,
    itemCode: l.material?.materialCode ?? null,
    description: l.material?.name ?? null,
    profile: l.profile,
    grade: l.grade,
    unit: l.unit || l.material?.unit || null,
    materialCode: l.material?.materialCode ?? null,
    materialName: l.material?.name ?? null,
    quantity: Number(l.quantity) || 0,
  }))
}
