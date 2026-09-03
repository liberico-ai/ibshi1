import { isMissingTableError, MIGRATION_HINT } from '@/lib/db-missing-table'
import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles, logAudit, getClientIP } from '@/lib/auth'
import {
  buildWoMaterialLines, suggestBomMaterialsForWo, setWoMaterialRequests, normalizeRequestItems,
  canRequestMaterialForWo, whyCannotRequestMaterial, isSubcontractWo,
  WO_MATERIAL_REQUEST_ROLES, MR_STATUS, MR_EDITABLE, nextMaterialRequestCode,
} from '@/lib/wo-materials'
import { notifyMaterialRequestSubmitted } from '@/lib/material-request-flow'
import { isProjectPm } from '@/lib/project-pm'

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
        pieceMark: true, projectId: true, bomVersionId: true, plannedWeight: true, aplLineId: true, aplImportId: true, aplItem: true,
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

    // ── APL: vật tư lấy từ CHÍNH dòng cụm đã sinh ra lệnh này ──
    // BOM/PR là nguồn cũ; với lệnh phát hành từ APL thì vật tư nằm ngay ở các dòng chi tiết của
    // cụm. Gộp theo (quy cách + mác) rồi khớp về mã kho qua 3 tầng luật/lịch sử/bí danh.
    // Cặp CHƯA CÓ MÃ vẫn trả về nhưng đánh dấu needsCode — giao diện không cho gửi duyệt.
    // WO mới giao theo ITEM (aplImportId + aplItem); WO cũ giao theo dòng vàng (aplLineId).
    const aplWos = workOrders.filter(w => w.aplImportId || w.aplLineId)
    // Vật tư của APL — CHỈ ĐỂ XEM, không so khớp sang kho nữa.
    //
    // APL ghi CẤU KIỆN đã thành hình (GR32*1187 SS400, CHS48.3*5.1 A53GRB), còn thứ xưởng
    // lĩnh về để LÀM RA cấu kiện đó là nguyên liệu trong kho. Hai cái khác cấp nhau, nên
    // việc so khớp cũ vốn khớp nhầm cấp và đẻ ra hàng chục dòng "kho chưa có mã" oan cho
    // Kho/Thương mại. Bỏ đi; xưởng nhìn bảng này rồi tự chọn nguyên liệu từ kho.
    // Hàm so khớp vẫn giữ nguyên trong apl-material-match.ts, chưa xoá.
    const apl: { key: string; profile: string; grade: string; label: string; unit: string; weightKg: number }[] = []
    if (aplWos.length > 0) {
      const legacyIds = aplWos.filter(w => !w.aplImportId && w.aplLineId).map(w => w.aplLineId!)
      const legacyHeads = legacyIds.length
        ? await prisma.aplLine.findMany({
            where: { id: { in: legacyIds } },
            select: { id: true, importId: true, item: true },
          })
        : []
      const legacyByLine = new Map(legacyHeads.map(h => [h.id, h]))

      /** Mỗi WO ứng với một (bản APL, ITEM) — vật tư gom từ MỌI dòng chi tiết của ITEM đó. */
      const scopeOf = (w: { aplImportId: string | null; aplItem: string | null; aplLineId: string | null }) => {
        if (w.aplImportId) return { importId: w.aplImportId, item: w.aplItem || '' }
        const h = w.aplLineId ? legacyByLine.get(w.aplLineId) : undefined
        return h ? { importId: h.importId, item: h.item || '' } : null
      }

      const scopes = aplWos.map(scopeOf).filter((x): x is { importId: string; item: string } => !!x)
      const kids = scopes.length
        ? await prisma.aplLine.findMany({
            where: {
              isAssembly: false,
              OR: scopes.map(s => ({
                importId: s.importId,
                ...(s.item ? { item: s.item } : { OR: [{ item: null }, { item: '' }] }),
              })),
            },
            select: { importId: true, item: true, profile: true, grade: true, totalWeightKg: true },
          })
        : []

      // Gộp theo profile + mác thép, cộng dồn kg. Mỗi (bản APL, ITEM) chỉ tính MỘT lần dù
      // nhiều lệnh cùng trỏ vào nó — đây là bảng tham khảo, không phải số để cấp.
      const seen = new Set<string>()
      const acc = new Map<string, (typeof apl)[number]>()
      for (const wo of aplWos) {
        const sc = scopeOf(wo)
        if (!sc) continue
        const scopeKey = `${sc.importId}::${sc.item}`
        if (seen.has(scopeKey)) continue
        seen.add(scopeKey)
        for (const k of kids) {
          if (k.importId !== sc.importId || (k.item || '') !== sc.item) continue
          const profile = (k.profile || '').trim()
          const grade = (k.grade || '').trim()
          const label = [profile, grade].filter(Boolean).join(' ')
          if (!label) continue
          const row = acc.get(label) || { key: label, profile, grade, label, unit: 'kg', weightKg: 0 }
          row.weightKg += k.totalWeightKg || 0
          acc.set(label, row)
        }
      }
      apl.push(...[...acc.values()].sort((a, b) => b.weightKg - a.weightKg))
    }

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
    // Quyền xét theo TỪNG lệnh: xưởng lo lệnh của xưởng mình, PM lo lệnh giao thầu phụ.
    const pmOfProject = new Map<string, boolean>()
    for (const pid of [...new Set(workOrders.map(w => w.projectId))]) {
      pmOfProject.set(pid, await isProjectPm(user.userId, pid))
    }
    const outOfScope = workOrders
      .filter(w => !canRequestMaterialForWo(
        { roleCode: user.roleCode, departmentId: userDept, isProjectPm: !!pmOfProject.get(w.projectId) }, w))
      .map(w => w.woCode)

    return successResponse({
      workOrders: workOrders.map(w => ({ ...w, plannedWeight: w.plannedWeight ? Number(w.plannedWeight) : null })),
      bom: [...bomMap.values()],
      apl,
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
      return errorResponse('Chỉ Xưởng sản xuất hoặc PM phụ trách dự án (lệnh thầu phụ) được lập đề nghị cấp vật tư', 403)
    }

    const body = await req.json().catch(() => ({}))
    const allocations = (body?.allocations || {}) as Record<string, unknown[]>
    const submit = body?.submit === true
    const woIds = Object.keys(allocations)
    if (woIds.length === 0) return errorResponse('Chưa chọn lệnh sản xuất nào')

    const workOrders = await prisma.workOrder.findMany({
      where: { id: { in: woIds } },
      select: { id: true, woCode: true, status: true, departmentId: true, projectId: true, woType: true, teamCode: true },
    })
    if (workOrders.length !== woIds.length) return errorResponse('Có lệnh sản xuất không tồn tại', 404)

    const projectIds = [...new Set(workOrders.map(w => w.projectId))]
    if (projectIds.length > 1) return errorResponse('Chỉ lập chung cho các lệnh CÙNG một dự án')

    const userDept = await loadUserDept(user.userId)
    const actorIsProjectPm = await isProjectPm(user.userId, projectIds[0])
    const actor = { roleCode: user.roleCode, departmentId: userDept, isProjectPm: actorIsProjectPm }
    for (const wo of workOrders) {
      if (['COMPLETED', 'CANCELLED'].includes(wo.status)) return errorResponse(`${wo.woCode} đã hoàn thành/hủy — không sửa được đề nghị vật tư`)
      if (!canRequestMaterialForWo(actor, wo)) return errorResponse(whyCannotRequestMaterial(actor, wo), 403)
    }
    // Phiếu do PM lập cho lệnh thầu phụ đã MANG SẴN chữ ký PM — bắt PM tự duyệt phiếu của
    // chính mình thì chặng duyệt đó không còn tác dụng gì. Đẩy thẳng lên BGĐ.
    const pmSelfSigned = actorIsProjectPm && workOrders.every(w => isSubcontractWo(w))

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
        status: pmSelfSigned ? MR_STATUS.PENDING_BOD : MR_STATUS.PENDING_PM,
        submittedAt: new Date(),
        ...(pmSelfSigned ? { pmApprovedBy: user.userId, pmApprovedAt: new Date() } : {}),
        rejectReason: null, rejectedAt: null, rejectedBy: null,
      },
    })
    await notifyMaterialRequestSubmitted(submitted.id, user.userId).catch(e => console.error('[MR] notify:', e))
    await logAudit(user.userId, 'SUBMIT_MATERIAL_REQUEST', 'MaterialRequestOrder', order.id,
      { code: order.code, lines: totalLines, workOrders: saved.map(s => s.woCode) }, getClientIP(req))

    return successResponse({ order: submitted, saved },
      `Đã gửi phiếu ${submitted.code} cho ${pmSelfSigned ? 'BGĐ' : 'PM'} duyệt (${totalLines} dòng, ${saved.length} lệnh)`)
  } catch (err) {
    console.error('POST /api/production/material-requests error:', err)
    if (isMissingTableError(err)) return errorResponse(MIGRATION_HINT, 503)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
