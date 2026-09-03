import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { rollUpWorkOrder } from '@/lib/production-weights'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { isWoReportable } from '@/lib/wo-status'
import { createWithCode } from '@/lib/next-code'
import { getWorkshopScope } from '@/lib/workshop-scope'
import { validateBody } from '@/lib/api-helpers'
import { createJobCardSchema } from '@/lib/schemas'

// GET /api/production/job-cards — List job cards
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const woId = url.searchParams.get('workOrderId') || undefined
  const teamCode = url.searchParams.get('teamCode') || undefined
  const status = url.searchParams.get('status') || undefined
  const page = parseInt(url.searchParams.get('page') || '1')
  const limit = parseInt(url.searchParams.get('limit') || '20')

  const workType = url.searchParams.get('workType') || undefined

  const projectId = url.searchParams.get('projectId') || undefined

  const where: Record<string, unknown> = {}
  if (woId) where.workOrderId = woId
  if (teamCode) where.teamCode = teamCode
  if (status) where.status = status
  if (workType) where.workType = workType
  // Xưởng chỉ thấy phiếu của lệnh thuộc xưởng mình — cùng luật với màn Sản xuất.
  // QAQC/PM/BGĐ không bị giới hạn: màn tạo ITP phải thấy phiếu của mọi xưởng.
  const { scope, scopeMissing, woWhere } = await getWorkshopScope(user.userId, user.roleCode)

  // Lọc theo dự án: dùng cho màn ITP (chỉ kiểm tra lệnh của dự án đang chọn)
  const woFilter: Record<string, unknown> = {}
  if (projectId) woFilter.projectId = projectId
  if (woWhere) Object.assign(woFilter, woWhere)
  if (Object.keys(woFilter).length > 0) where.workOrder = woFilter

  const [total, jobCards] = await Promise.all([
    prisma.jobCard.count({ where }),
    prisma.jobCard.findMany({
      where,
      include: {
        workOrder: { select: { woCode: true, description: true, projectId: true, plannedWeight: true, teamCode: true, pieceMark: true, status: true } },
      },
      orderBy: { workDate: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ])

  const result = jobCards.map(jc => ({
    ...jc,
    plannedQty: jc.plannedQty ? Number(jc.plannedQty) : null,
    actualQty: jc.actualQty ? Number(jc.actualQty) : null,
    workOrder: { ...jc.workOrder, plannedWeight: jc.workOrder.plannedWeight ? Number(jc.workOrder.plannedWeight) : null },
  }))

  return successResponse({
    jobCards: result,
    scope, scopeMissing,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  })
}

// POST /api/production/job-cards — Create job card (daily input by team leader)
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01', 'R06', 'R06a', 'R06b'])) {
    return errorResponse('Không có quyền tạo phiếu công việc', 403)
  }

  const result = await validateBody(req, createJobCardSchema)
  if (!result.success) return result.response
  const { workOrderId, workType: rawType, description, plannedQty, actualQty, unit, workDate, manpower, notes } = result.data

  // 'production' = báo khối lượng cho cả WO, không phân công đoạn.
  const workType = (rawType || '').trim() || 'production'

  const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId } })
  if (!wo) return errorResponse('Không tìm thấy WO')
  if (!isWoReportable(wo.status)) {
    return errorResponse('WO đã hoàn thành hoặc hủy')
  }

  // Mã phiếu: lấy số lớn nhất đang có +1, đụng thì thử tiếp — ba xưởng cùng báo một ngày
  // là chuyện thường từ khi một ITEM giao được cho nhiều xưởng.
  const year = new Date().getFullYear().toString().slice(-2)
  const jobCard = await createWithCode({
    prefix: `JC-${year}-`,
    findLatest: async prefix => (await prisma.jobCard.findFirst({
      where: { jobCode: { startsWith: prefix } },
      orderBy: { jobCode: 'desc' }, select: { jobCode: true },
    }))?.jobCode ?? null,
  }, jobCode => prisma.jobCard.create({
    data: {
      jobCode,
      workOrderId,
      teamCode: wo.teamCode,
      workType,
      description: description || `Báo khối lượng — ${wo.woCode}`,
      plannedQty: plannedQty || null,
      actualQty: actualQty ?? null,
      unit: unit || 'kg',
      workDate: new Date(workDate),
      manpower: manpower || null,
      status: 'IN_PROGRESS',
      reportedBy: user.userId,
      notes: notes || null,
    },
    include: {
      workOrder: { select: { woCode: true } },
    },
  }))

  // Cập nhật tiến độ WO ngay khi báo — cộng dồn kg thực tế, đạt ≥90% kế hoạch thì tự xong.
  await rollUpWorkOrder(workOrderId)

  return successResponse({
    jobCard: { ...jobCard, plannedQty: Number(jobCard.plannedQty), actualQty: Number(jobCard.actualQty) },
    message: `Đã tạo phiếu ${jobCard.jobCode}`,
  })
}
