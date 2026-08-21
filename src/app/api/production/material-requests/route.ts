import { isMissingTableError, MIGRATION_HINT } from '@/lib/db-missing-table'
import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles, logAudit, getClientIP } from '@/lib/auth'
import {
  buildWoMaterialLines, suggestBomMaterialsForWo, setWoMaterialRequests, normalizeRequestItems,
  canWorkshopEditWo, WO_MATERIAL_REQUEST_ROLES, MR_STATUS, MR_EDITABLE, nextMaterialRequestCode,
} from '@/lib/wo-materials'
import { notifyMaterialRequestSubmitted } from '@/lib/material-request-flow'

// Xưởng lập PHIẾU đề nghị cấp vật tư cho một hoặc nhiều lệnh sản xuất.
//   GET  ?woIds=a,b,c[&requestId=] → gợi ý BOM (định mức từng WO) + vật tư PR của dự án + phiếu đang mở
//   POST { allocations: {woId: [...]}, requestId?, submit? } → lưu nháp, submit=true thì gửi PM duyệt
// Kho CHỈ thấy phiếu đã duyệt đủ PM + BGĐ (xem api/production/material-issue).

async function loadUserDept(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { departmentId: true } })
  return u?.departmentId ?? null
}

export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const url = new URL(req.url)
    const woIds = (url.searchParams.get('woIds') || '').split(',').map(s => s.trim()).filter(Boolean)
    const requestIdParam = url.searchParams.get('requestId') || undefined
    if (woIds.length === 0) return errorResponse('Thiếu danh sách lệnh sản xuất (woIds)')

    const workOrders = await prisma.workOrder.findMany({
      where: { id: { in: woIds } },
      select: {
        id: true, woCode: true, description: true, status: true, teamCode: true, departmentId: true,
        pieceMark: true, projectId: true, bomVersionId: true, plannedWeight: true,
        project: { select: { projectCode: true, projectName: true } },
      },
    })
    if (workOrders.length === 0) return errorResponse('Không tìm thấy lệnh sản xuất nào', 404)

    const projectIds = [...new Set(workOrders.map(w => w.projectId))]
    if (projectIds.length > 1) return errorResponse('Chỉ lập chung cho các lệnh CÙNG một dự án')

    // ── BOM: định mức riêng của từng WO theo piece-mark, gộp thành 1 hàng/vật tư ──
    const bomMap = new Map<string, {
      materialId: string; materialCode: string; name: string; specification: string | null
      unit: string; currentStock: number; perWo: Record<string, number>
    }>()
    for (const wo of workOrders) {
      const list = await suggestBomMaterialsForWo(wo)
      for (const s of list) {
        const row = bomMap.get(s.materialId) || {
          materialId: s.materialId, materialCode: s.materialCode, name: s.name,
          specification: s.specification, unit: s.unit, currentStock: s.currentStock, perWo: {},
        }
        row.perWo[wo.id] = (row.perWo[wo.id] || 0) + s.quantity
        bomMap.set(s.materialId, row)
      }
    }

    // ── PR của dự án: vật tư tiêu hao/phụ không nằm trong BOM piece-mark ──
    // materialId của dòng PR có thể NULL (mã chưa chuẩn hoá) → vẫn trả về, FE hiện nút "Tạo mã".
    const prItems = await prisma.purchaseRequestItem.findMany({
      where: { purchaseRequest: { projectId: projectIds[0] } },
      select: {
        materialId: true, itemCode: true, description: true, unit: true, quantity: true,
        specification: true, profile: true, grade: true,
        material: { select: { materialCode: true, name: true, unit: true, currentStock: true, specification: true } },
      },
      take: 500,
    })
    const prMap = new Map<string, {
      key: string; materialId: string | null; materialCode: string; name: string
      specification: string | null; unit: string; currentStock: number; prQuantity: number; needsCode: boolean
    }>()
    for (const it of prItems) {
      const code = it.material?.materialCode || it.itemCode || ''
      const name = it.material?.name || it.description || code
      if (!code && !name) continue
      const key = it.materialId || `nocode:${code || name}`
      const prev = prMap.get(key)
      prMap.set(key, {
        key,
        materialId: it.materialId,
        materialCode: code || '(chưa có mã)',
        name,
        specification: it.material?.specification || it.specification || [it.profile, it.grade].filter(Boolean).join(' · ') || null,
        unit: it.unit || it.material?.unit || 'kg',
        currentStock: Number(it.material?.currentStock ?? 0),
        prQuantity: (prev?.prQuantity || 0) + Number(it.quantity || 0),
        needsCode: !it.materialId,
      })
    }
    const pr = [...prMap.values()].filter(p => !p.materialId || !bomMap.has(p.materialId))

    const userDept = await loadUserDept(user.userId)

    // ── Phiếu đang mở của xưởng cho nhóm lệnh này (nháp/bị trả lại) → điền sẵn để sửa tiếp ──
    const openOrder = requestIdParam
      ? await prisma.materialRequestOrder.findUnique({ where: { id: requestIdParam } })
      : await prisma.materialRequestOrder.findFirst({
          where: {
            projectId: projectIds[0],
            status: { in: MR_EDITABLE },
            ...(userDept ? { departmentId: userDept } : {}),
            items: { some: { workOrderId: { in: woIds } } },
          },
          orderBy: { createdAt: 'desc' },
        })

    const existing: Record<string, Awaited<ReturnType<typeof buildWoMaterialLines>>> = {}
    for (const wo of workOrders) {
      existing[wo.id] = openOrder
        ? await buildWoMaterialLines(wo.id, { requestId: openOrder.id })
        : await buildWoMaterialLines(wo.id)   // chưa có phiếu mở → hiện phần đã duyệt để đối chiếu
    }

    const canEdit = requireRoles(user.roleCode, WO_MATERIAL_REQUEST_ROLES)
    const outOfScope = workOrders.filter(w => !canWorkshopEditWo(userDept, w)).map(w => w.woCode)

    return successResponse({
      workOrders: workOrders.map(w => ({ ...w, plannedWeight: w.plannedWeight ? Number(w.plannedWeight) : null })),
      bom: [...bomMap.values()],
      pr,
      existing,
      canEdit,
      outOfScope,
      order: openOrder,
    })
  } catch (err) {
    console.error('GET /api/production/material-requests error:', err)
    if (isMissingTableError(err)) return errorResponse(MIGRATION_HINT, 503)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, WO_MATERIAL_REQUEST_ROLES)) {
      return errorResponse('Chỉ Xưởng sản xuất (quản đốc/nhân viên/tổ trưởng) được lập đề nghị cấp vật tư', 403)
    }

    const body = await req.json().catch(() => ({}))
    const allocations = (body?.allocations || {}) as Record<string, unknown[]>
    const submit = body?.submit === true
    const woIds = Object.keys(allocations)
    if (woIds.length === 0) return errorResponse('Chưa chọn lệnh sản xuất nào')

    const workOrders = await prisma.workOrder.findMany({
      where: { id: { in: woIds } },
      select: { id: true, woCode: true, status: true, departmentId: true, projectId: true },
    })
    if (workOrders.length !== woIds.length) return errorResponse('Có lệnh sản xuất không tồn tại', 404)

    const projectIds = [...new Set(workOrders.map(w => w.projectId))]
    if (projectIds.length > 1) return errorResponse('Chỉ lập chung cho các lệnh CÙNG một dự án')

    const userDept = await loadUserDept(user.userId)
    for (const wo of workOrders) {
      if (['COMPLETED', 'CANCELLED'].includes(wo.status)) return errorResponse(`${wo.woCode} đã hoàn thành/hủy — không sửa được đề nghị vật tư`)
      if (!canWorkshopEditWo(userDept, wo)) return errorResponse(`${wo.woCode} không thuộc xưởng của bạn (lệnh thầu phụ chưa mở luồng này)`, 403)
    }

    // Phiếu: dùng lại phiếu đang mở nếu có, không thì tạo mới
    let order = body?.requestId
      ? await prisma.materialRequestOrder.findUnique({ where: { id: String(body.requestId) } })
      : null
    if (!order) {
      order = await prisma.materialRequestOrder.findFirst({
        where: {
          projectId: projectIds[0], status: { in: MR_EDITABLE },
          ...(userDept ? { departmentId: userDept } : {}),
          items: { some: { workOrderId: { in: woIds } } },
        },
        orderBy: { createdAt: 'desc' },
      })
    }
    if (order && !MR_EDITABLE.includes(order.status)) {
      return errorResponse(`Phiếu ${order.code} đang ở trạng thái "${order.status}" — không sửa được nữa`)
    }
    if (!order) {
      order = await prisma.materialRequestOrder.create({
        data: {
          code: await nextMaterialRequestCode(projectIds[0]),
          projectId: projectIds[0], departmentId: userDept, status: MR_STATUS.DRAFT, createdBy: user.userId,
        },
      })
    }

    const saved: { woCode: string; count: number }[] = []
    for (const wo of workOrders) {
      const items = normalizeRequestItems(Array.isArray(allocations[wo.id]) ? allocations[wo.id] : [])
      const err = await setWoMaterialRequests(order.id, wo.id, items, user.userId)
      if (err) return errorResponse(`${wo.woCode}: ${err}`)
      saved.push({ woCode: wo.woCode, count: items.length })
    }

    const totalLines = saved.reduce((s, x) => s + x.count, 0)

    if (!submit) {
      await prisma.materialRequestOrder.update({
        where: { id: order.id },
        data: { status: MR_STATUS.DRAFT, rejectReason: null, rejectedAt: null, rejectedBy: null },
      })
      await logAudit(user.userId, 'SAVE_MATERIAL_REQUEST', 'MaterialRequestOrder', order.id,
        { code: order.code, lines: totalLines }, getClientIP(req))
      return successResponse({ order, saved }, `Đã lưu nháp phiếu ${order.code} (${totalLines} dòng, ${saved.length} lệnh)`)
    }

    if (totalLines === 0) return errorResponse('Phiếu chưa có vật tư nào — không gửi duyệt được')

    const submitted = await prisma.materialRequestOrder.update({
      where: { id: order.id },
      data: {
        status: MR_STATUS.PENDING_PM, submittedAt: new Date(),
        rejectReason: null, rejectedAt: null, rejectedBy: null,
      },
    })
    await notifyMaterialRequestSubmitted(submitted.id, user.userId).catch(e => console.error('[MR] notify:', e))
    await logAudit(user.userId, 'SUBMIT_MATERIAL_REQUEST', 'MaterialRequestOrder', order.id,
      { code: order.code, lines: totalLines, workOrders: saved.map(s => s.woCode) }, getClientIP(req))

    return successResponse({ order: submitted, saved },
      `Đã gửi phiếu ${submitted.code} cho PM duyệt (${totalLines} dòng, ${saved.length} lệnh)`)
  } catch (err) {
    console.error('POST /api/production/material-requests error:', err)
    if (isMissingTableError(err)) return errorResponse(MIGRATION_HINT, 503)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
