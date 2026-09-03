'use server'

import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { validateQuery } from '@/lib/api-helpers'
import { searchFilterSchema } from '@/lib/schemas'
import { withErrorHandler } from '@/lib/with-error-handler'
import { canManageProject, notProjectPmMessage } from '@/lib/project-pm'
import { summarizeWoMaterials } from '@/lib/wo-materials'
import { getWorkshopScope } from '@/lib/workshop-scope'
import { SUBCONTRACT_TEAM_CODE } from '@/lib/material-request-constants'
import { reconcileWorkOrdersQc } from '@/lib/itp-wo-sync'
import { getWoAcceptance } from '@/lib/wo-acceptance'

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
  // status nhận một mã hoặc danh sách ngăn bằng dấu phẩy (vd 'OPEN,IN_PROGRESS') —
  // để màn phiếu công việc lấy đủ lệnh trong MỘT lần gọi thay vì gọi từng trạng thái.
  if (status) {
    const codes = status.split(',').map(x => x.trim()).filter(Boolean)
    where.status = codes.length > 1 ? { in: codes } : codes[0]
  }
  if (projectId) where.projectId = projectId
  if (departmentId) where.departmentId = departmentId
  if (search) {
    where.OR = [
      { woCode: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { pieceMark: { contains: search, mode: 'insensitive' } },
    ]
  }

  // Xưởng chỉ thấy việc của xưởng mình — luật khai chung ở workshop-scope.ts để màn Sản xuất
  // và màn Phiếu công việc không lệch nhau. BGĐ / PM / KTKH / Admin vẫn thấy toàn bộ.
  const { scope, scopeMissing, woWhere } = await getWorkshopScope(payload.userId, payload.roleCode)
  if (woWhere) where.AND = [woWhere]

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

  // Tình trạng vật tư — cột riêng, không gộp vào trạng thái. Trạng thái WO chỉ nói lệnh
  // đang ở đâu trong sản xuất; cấp vật tư tới đâu là chuyện khác, và sau khi lệnh chạy
  // thì trạng thái không còn mang tin đó nữa. Gộp cả trang trong 2 truy vấn.
  const matSummary = await summarizeWoMaterials(workOrders.map(w => w.id))
  const accSummary = await getWoAcceptance(workOrders.map(w => w.id))

  const result = workOrders.map((wo) => ({
    id: wo.id,
    woCode: wo.woCode,
    projectId: wo.projectId,
    description: wo.description,
    teamCode: wo.teamCode,
    status: fixedStatus.get(wo.id) ?? wo.status,
    pieceMark: wo.pieceMark,
    materials: wo.materials,
    woType: wo.woType,
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
    material: matSummary.get(wo.id) ?? { total: 0, done: 0, state: null },
    // Nghiệm thu theo đợt: đã ký bao nhiêu kg, còn bao nhiêu chờ mời nghiệm thu.
    acceptance: accSummary.get(wo.id) ?? null,
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
  // Lệnh GIAO THẦU PHỤ: không thuộc xưởng nào — đánh dấu bằng woType EXTERNAL để phân biệt
  // với lệnh nội bộ lỡ thiếu phòng (lỗi dữ liệu). Vật tư cho lệnh này do PM lo.
  const isSub = (teamCode || '').toUpperCase() === SUBCONTRACT_TEAM_CODE
  let resolvedDeptId: string | null = isSub ? null : (departmentId || null)
  if (!isSub && !resolvedDeptId) {
    const dept = await prisma.department.findFirst({ where: { code: teamCode }, select: { id: true } })
    resolvedDeptId = dept?.id ?? null
  }

  const wo = await prisma.workOrder.create({
    data: {
      woCode,
      projectId,
      description,
      teamCode: isSub ? SUBCONTRACT_TEAM_CODE : teamCode,
      woType: isSub ? 'EXTERNAL' : 'INTERNAL',
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
