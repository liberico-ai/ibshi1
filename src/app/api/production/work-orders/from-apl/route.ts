import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { describeDbError } from '@/lib/db-missing-table'
import { canManageProject, notProjectPmMessage } from '@/lib/project-pm'
import { aplItemWoCode, aplItemWoDescription, rollupItemMaterials, formatMaterialsColumn } from '@/lib/apl-wo'

export const dynamic = 'force-dynamic'

// GET ?importId=&item= — xem trước một ITEM sẽ ra lệnh thế nào (khối lượng, vật tư đã cộng dồn)
// trước khi phát hành. Không ghi gì.
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const sp = req.nextUrl.searchParams
    const importId = (sp.get('importId') || '').trim()
    if (!importId) return errorResponse('Thiếu bản APL')
    const rawItem = sp.get('item')
    if (rawItem === null) return errorResponse('Thiếu ITEM')
    const item = rawItem.trim()
    const itemWhere = item ? { item } : { OR: [{ item: null }, { item: '' }] }

    const [heads, details, existing] = await Promise.all([
      prisma.aplLine.findMany({
        where: { importId, isAssembly: true, ...itemWhere },
        select: { rollupWeightKg: true },
      }),
      prisma.aplLine.findMany({
        where: { importId, isAssembly: false, ...itemWhere },
        select: { profile: true, grade: true, totalWeightKg: true },
      }),
      prisma.workOrder.findFirst({
        where: { aplImportId: importId, aplItem: item || null },
        select: { woCode: true, teamCode: true, status: true },
      }),
    ])

    const mats = rollupItemMaterials(details)
    return successResponse({
      item,
      blocks: heads.length,
      detailLines: details.length,
      weightKg: heads.reduce((s, h) => s + (Number(h.rollupWeightKg) || 0), 0),
      materials: mats,
      alreadyIssued: existing,
    })
  } catch (err) {
    console.error('GET /api/production/work-orders/from-apl error:', err)
    return errorResponse(describeDbError(err, 'Lỗi khi xem trước ITEM'), 500)
  }
}

// POST /api/production/work-orders/from-apl
// body: { projectId, importId, item, teamCode?, plannedStart?, plannedEnd? }
//
// MỘT ITEM = MỘT WO = MỘT XƯỞNG (chốt nghiệp vụ 2026-08).
//   • Khối lượng  = tổng rollupWeightKg của mọi dòng vàng trong ITEM (đúng cột xanh ở màn chọn)
//   • Vật tư      = gom mọi dòng chi tiết trong ITEM, trùng (profile+grade) thì cộng dồn kg
//   • Thời gian   = PM nhập tay
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const body = await req.json().catch(() => null) as {
      projectId?: string; importId?: string; item?: string
      teamCode?: string; plannedStart?: string; plannedEnd?: string
    } | null
    if (!body?.projectId) return errorResponse('Thiếu dự án')
    if (!body.importId) return errorResponse('Thiếu bản APL')
    // ITEM rỗng là hợp lệ: bản APL cũ dồn hết vào nhóm "(không có ITEM)".
    const item = String(body.item ?? '').trim()
    if (body.item === undefined || body.item === null) return errorResponse('Chưa chọn ITEM để phát hành')

    const project = await prisma.project.findUnique({
      where: { id: body.projectId },
      select: { id: true, projectCode: true },
    })
    if (!project) return errorResponse('Không tìm thấy dự án', 404)

    // Quyền: PM phụ trách dự án (nhiều PM ngang quyền) hoặc BGĐ
    if (!(await canManageProject(user.roleCode, user.userId, project.id))) {
      const pmCount = await prisma.projectPm.count({ where: { projectId: project.id } })
      return errorResponse(notProjectPmMessage(pmCount > 0), 403)
    }

    // Khớp ITEM: chuỗi rỗng ứng với cả null lẫn '' trong DB.
    const itemWhere = item ? { item } : { OR: [{ item: null }, { item: '' }] }

    const heads = await prisma.aplLine.findMany({
      where: { importId: body.importId, isAssembly: true, ...itemWhere },
      select: { id: true, rollupWeightKg: true },
    })
    if (heads.length === 0) return errorResponse('ITEM này không có cụm nào trong bản APL đã chọn')

    // Đã phát hành rồi thì không tạo trùng — một ITEM chỉ có một lệnh.
    const existing = await prisma.workOrder.findFirst({
      where: { aplImportId: body.importId, aplItem: item || null },
      select: { woCode: true },
    })
    if (existing) {
      return errorResponse(`ITEM này đã phát hành lệnh ${existing.woCode} rồi`, 409)
    }

    const weightKg = heads.reduce((s, h) => s + (Number(h.rollupWeightKg) || 0), 0)

    // Vật tư: quét MỌI dòng chi tiết của ITEM. Một ITEM tới ~3.200 dòng nên chỉ lấy đúng
    // ba cột cần dùng, không kéo cả bản ghi về.
    const details = await prisma.aplLine.findMany({
      where: { importId: body.importId, isAssembly: false, ...itemWhere },
      select: { profile: true, grade: true, totalWeightKg: true },
    })
    const mats = rollupItemMaterials(details)

    // Mã WO trùng (tên ITEM khác nhau nhưng chuẩn hoá về cùng chuỗi) thì thêm số thứ tự.
    let woCode = aplItemWoCode(project.projectCode, item)
    for (let n = 2; n <= 50; n++) {
      const dup = await prisma.workOrder.findUnique({ where: { woCode }, select: { id: true } })
      if (!dup) break
      woCode = aplItemWoCode(project.projectCode, item, n)
    }

    const dept = body.teamCode
      ? await prisma.department.findFirst({ where: { code: body.teamCode }, select: { id: true } })
      : null
    const toDate = (s?: string) => (s ? new Date(s) : null)

    const wo = await prisma.workOrder.create({
      data: {
        woCode,
        projectId: project.id,
        description: aplItemWoDescription(item, heads.length),
        // Vật tư để CỘT RIÊNG, không nhét vào mô tả — nhét vào thì cắt ngắn là mất chữ,
        // mà lọc/tìm theo vật tư cũng không được.
        materials: formatMaterialsColumn(mats),
        aplImportId: body.importId,
        aplItem: item || null,
        pieceMark: item || null,
        teamCode: body.teamCode || '',
        departmentId: dept?.id || null,
        woType: 'INTERNAL',
        plannedWeight: weightKg > 0 ? weightKg : null,
        plannedStart: toDate(body.plannedStart),
        plannedEnd: toDate(body.plannedEnd),
        createdBy: user.userId,
      },
      select: { id: true, woCode: true },
    })

    await logAudit(user.userId, 'CREATE_WO_FROM_APL', 'Project', project.id,
      { importId: body.importId, item, woCode, blocks: heads.length, weightKg, materials: mats.length },
      getClientIP(req))

    return successResponse(
      {
        workOrder: { id: wo.id, woCode: wo.woCode },
        blocks: heads.length,
        detailLines: details.length,
        weightKg,
        materials: mats.slice(0, 20),
        materialCount: mats.length,
      },
      `Đã phát hành ${wo.woCode} — ${heads.length} cụm, ${Math.round(weightKg).toLocaleString('vi-VN')} kg, ${mats.length} loại vật tư`,
      201,
    )
  } catch (err) {
    console.error('POST /api/production/work-orders/from-apl error:', err)
    return errorResponse(describeDbError(err, 'Lỗi khi phát hành WO từ APL'), 500)
  }
}
