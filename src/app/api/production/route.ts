'use server'

import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { validateQuery } from '@/lib/api-helpers'
import { searchFilterSchema } from '@/lib/schemas'
import { withErrorHandler } from '@/lib/with-error-handler'
import { canManageProject, notProjectPmMessage } from '@/lib/project-pm'
import { WO_MATERIAL_REQUEST_ROLES } from '@/lib/wo-materials'
import { reconcileWorkOrdersQc } from '@/lib/itp-wo-sync'

// Vai trò bị giới hạn xem lệnh theo xưởng của mình (dùng chung danh sách với quyền đề nghị vật tư).
const WORKSHOP_SCOPED_ROLES: string[] = WO_MATERIAL_REQUEST_ROLES

// GET /api/production — List work orders
export const GET = withErrorHandler(async (req: NextRequest) => {
  const payload = await authenticateRequest(req)
  if (!payload) return unauthorizedResponse()

  const qResult = validateQuery(req.url, searchFilterSchema)
  if (!qResult.success) return qResult.response
  const { page, limit, search, status } = qResult.data
  const projectId = new URL(req.url).searchParams.get('projectId')

  const departmentId = new URL(req.url).searchParams.get('departmentId')

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (projectId) where.projectId = projectId
  if (departmentId) where.departmentId = departmentId
  if (search) {
    where.OR = [
      { woCode: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { pieceMark: { contains: search, mode: 'insensitive' } },
    ]
  }

  // ── Xưởng chỉ thấy LỆNH CỦA XƯỞNG MÌNH ──
  // Quản đốc/nhân viên/tổ trưởng (R06/R06a/R06b) bị giới hạn theo phòng của tài khoản.
  // Lệnh giao thầu phụ làm ngoài (không gắn xưởng) VẪN HIỆN để xưởng theo dõi; riêng phần đề nghị
  // vật tư cho thầu phụ thì chưa mở (xem canWorkshopEditWo) — chờ chốt hướng xử lý.
  // BGĐ / PM / KTKH / Admin vẫn thấy toàn bộ.
  let scope: { departmentId: string; code: string; name: string } | null = null
  let scopeMissing = false
  if (WORKSHOP_SCOPED_ROLES.includes(payload.roleCode)) {
    const me = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { department: { select: { id: true, code: true, name: true } } },
    })
    if (me?.department) {
      scope = { departmentId: me.department.id, code: me.department.code, name: me.department.name }
      where.AND = [{ OR: [{ departmentId: me.department.id }, { departmentId: null }] }]
    } else {
      // Tài khoản xưởng chưa gắn phòng → chỉ còn thấy lệnh không thuộc xưởng nào, kèm cờ báo để
      // giao diện nhắc gắn phòng (im lặng cho thấy hết là hở quyền).
      scopeMissing = true
      where.AND = [{ departmentId: null }]
    }
  }

  const [total, workOrders] = await Promise.all([
    prisma.workOrder.count({ where }),
    prisma.workOrder.findMany({
      where,
      include: {
        materialIssues: {
          select: { id: true, materialId: true, quantity: true },
        },
        department: { select: { code: true, name: true } },
        project: { select: { projectCode: true, projectName: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ])

  // Trạng thái QC do màn Kế hoạch Kiểm tra (ITP) quyết định, và màn WO không còn nút bấm tay.
  // Nên so lại ngay lúc đọc danh sách: ITP đã đủ hai chữ ký mà WO còn "Chờ QC" thì tự sửa.
  // Chỉ ghi khi thật sự lệch — bình thường đây chỉ là một truy vấn đọc thêm.
  const fixed = await reconcileWorkOrdersQc(workOrders.map(w => w.id), payload.userId)
  const fixedStatus = new Map(fixed.map(f => [f.woId, f.to]))

  const result = workOrders.map((wo) => ({
    id: wo.id,
    woCode: wo.woCode,
    projectId: wo.projectId,
    description: wo.description,
    teamCode: wo.teamCode,
    status: fixedStatus.get(wo.id) ?? wo.status,
    pieceMark: wo.pieceMark,
    materials: wo.materials,
    aplLineId: wo.aplLineId,
    plannedWeight: wo.plannedWeight ? Number(wo.plannedWeight) : null,
    completedQty: wo.completedQty ? Number(wo.completedQty) : null,
    departmentId: wo.departmentId,
    department: wo.department,
    project: wo.project,
    plannedStart: wo.plannedStart,
    plannedEnd: wo.plannedEnd,
    actualStart: wo.actualStart,
    actualEnd: wo.actualEnd,
    materialIssueCount: wo.materialIssues.length,
    createdAt: wo.createdAt,
  }))

  return successResponse({
    workOrders: result,
    scope, scopeMissing,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  })
})

// POST /api/production — Create work order
export const POST = withErrorHandler(async (req: NextRequest) => {
  const payload = await authenticateRequest(req)
  if (!payload) return unauthorizedResponse()

  // Tạo LSX: chỉ PM (R02) phụ trách; BGĐ (R01) là cấp cao. QLSX (R06) + Tổ trưởng (R06b) KHÔNG còn tạo.
  if (!['R01', 'R02'].includes(payload.roleCode)) {
    return errorResponse('Không có quyền tạo lệnh sản xuất', 403)
  }

  const body = await req.json()
  const { woCode, projectId, description, teamCode, plannedStart, plannedEnd, pieceMark, bomVersionId, plannedWeight, departmentId } = body

  if (!woCode || !projectId || !description || !teamCode) {
    return errorResponse('Thiếu: mã WO, dự án, mô tả, tổ SX')
  }

  // Chỉ PM phụ trách dự án (hoặc BGĐ) mới tạo được WO cho dự án đó.
  const proj = await prisma.project.findUnique({ where: { id: projectId }, select: { pmUserId: true } })
  if (!proj) return errorResponse('Không tìm thấy dự án', 404)
  if (!(await canManageProject(payload.roleCode, payload.userId, projectId))) return errorResponse(notProjectPmMessage(!!proj.pmUserId), 403)

  const existing = await prisma.workOrder.findUnique({ where: { woCode } })
  if (existing) return errorResponse(`Mã WO ${woCode} đã tồn tại`)

  // teamCode = mã Xưởng (XPC/XCT1/…) từ dropdown. departmentId là FK tuỳ chọn: nếu FE không
  // gửi (dropdown đọc từ hằng số PRODUCTION_WORKSHOPS), tự tra Department theo teamCode — có
  // thì nối, DB chưa migrate tạo phòng xưởng thì để null (schema cho phép, WO vẫn tạo được).
  let resolvedDeptId: string | null = departmentId || null
  if (!resolvedDeptId) {
    const dept = await prisma.department.findFirst({ where: { code: teamCode }, select: { id: true } })
    resolvedDeptId = dept?.id ?? null
  }

  const wo = await prisma.workOrder.create({
    data: {
      woCode,
      projectId,
      description,
      teamCode,
      plannedStart: plannedStart ? new Date(plannedStart) : null,
      plannedEnd: plannedEnd ? new Date(plannedEnd) : null,
      pieceMark: pieceMark || null,
      bomVersionId: bomVersionId || null,
      plannedWeight: plannedWeight || null,
      departmentId: resolvedDeptId,
      createdBy: payload.userId,
    },
  })

  return successResponse({ workOrder: wo }, 'Lệnh sản xuất đã tạo', 201)
})
