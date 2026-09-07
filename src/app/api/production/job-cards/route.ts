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
        // Kèm MỌI công đoạn của lệnh — thẻ ngoài phải nói rõ lệnh được giao những công đoạn
        // nào, kể cả công đoạn chưa báo lần nào (nếu chỉ dựa vào phiếu thì chúng biến mất).
        workOrder: {
          select: {
            woCode: true, description: true, projectId: true, plannedWeight: true,
            teamCode: true, pieceMark: true, status: true,
            stages: {
              orderBy: { sortOrder: 'asc' },
              select: { id: true, stageCode: true, name: true, categoryCode: true, category: true, qty: true, unit: true },
            },
          },
        },
        stage: { select: { id: true, stageCode: true, name: true, categoryCode: true, category: true, qty: true, unit: true } },
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
    workOrder: {
      ...jc.workOrder,
      plannedWeight: jc.workOrder.plannedWeight ? Number(jc.workOrder.plannedWeight) : null,
      stages: jc.workOrder.stages.map(st => ({ ...st, qty: Number(st.qty) })),
    },
    stage: jc.stage ? { ...jc.stage, qty: Number(jc.stage.qty) } : null,
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
  const { workOrderId, workType: rawType, description, plannedQty, actualQty, lines, unit, workDate, manpower, notes } = result.data


  const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId } })
  if (!wo) return errorResponse('Không tìm thấy WO')
  if (!isWoReportable(wo.status)) {
    return errorResponse('WO đã hoàn thành hoặc hủy')
  }

  // ── Báo theo công đoạn ──
  // Lệnh có khai công đoạn thì mỗi công đoạn là một phần việc riêng, phải báo riêng —
  // gộp chung một ô khối lượng thì không biết đã cắt xong hay đã hàn xong.
  const stages = await prisma.workOrderStage.findMany({
    where: { workOrderId }, orderBy: { sortOrder: 'asc' },
    select: { id: true, stageCode: true, name: true, category: true, qty: true, unit: true },
  })
  const rawLines = lines ?? []
  if (stages.length > 0 && rawLines.length === 0 && !(actualQty && actualQty > 0)) {
    return errorResponse(`Lệnh này có ${stages.length} công đoạn — nhập khối lượng cho ít nhất một công đoạn`, 422)
  }
  for (const ln of rawLines) {
    if (!stages.some(st => st.id === ln.stageId)) {
      return errorResponse('Công đoạn được báo không thuộc lệnh này', 422)
    }
  }
  const trung = rawLines.map(l => l.stageId)
  if (new Set(trung).size !== trung.length) {
    return errorResponse('Một công đoạn bị khai hai lần trong cùng một lần báo', 422)
  }

  // Mỗi công đoạn một phiếu; lệnh nguyên khối vẫn là một phiếu như cũ.
  const toCreate = rawLines.length > 0
    ? rawLines.map(ln => {
      const st = stages.find(x => x.id === ln.stageId)!
      return {
        stageId: st.id as string | null,
        // workType giữ mã công đoạn để lọc/thống kê; nhãn đầy đủ nằm ở description.
        workType: st.stageCode || 'production',
        qty: ln.actualQty as number | null,
        planned: Number(st.qty) || null,
        unit: st.unit || unit || 'kg',
        label: `${st.name}${st.category ? ' · ' + st.category : ''} — ${wo.woCode}`,
      }
    })
    : [{
      stageId: null as string | null,
      workType: (rawType || '').trim() || 'production',
      qty: (actualQty ?? null) as number | null,
      planned: plannedQty || null,
      unit: unit || 'kg',
      label: description || `Báo khối lượng — ${wo.woCode}`,
    }]

  // Mã phiếu: lấy số lớn nhất đang có +1, đụng thì thử tiếp — ba xưởng cùng báo một ngày
  // là chuyện thường từ khi một ITEM giao được cho nhiều xưởng.
  const year = new Date().getFullYear().toString().slice(-2)
  const moPhieu = (c: typeof toCreate[number]) =>
    createWithCode({
      prefix: `JC-${year}-`,
      findLatest: async prefix => (await prisma.jobCard.findFirst({
        where: { jobCode: { startsWith: prefix } },
        orderBy: { jobCode: 'desc' }, select: { jobCode: true },
      }))?.jobCode ?? null,
    }, jobCode => prisma.jobCard.create({
      data: {
        jobCode,
        workOrderId,
        stageId: c.stageId,
        teamCode: wo.teamCode,
        workType: c.workType,
        description: c.label,
        plannedQty: c.planned,
        actualQty: c.qty,
        unit: c.unit,
        workDate: new Date(workDate),
        manpower: manpower || null,
        status: 'IN_PROGRESS',
        reportedBy: user.userId,
        notes: notes || null,
      },
      include: {
        workOrder: { select: { woCode: true } },
        stage: { select: { stageCode: true, name: true, category: true } },
      },
    }))
  const created: Awaited<ReturnType<typeof moPhieu>>[] = []
  for (const c of toCreate) created.push(await moPhieu(c))

  // Cập nhật tiến độ WO ngay khi báo. Lệnh có công đoạn thì tiến độ chạy theo công đoạn
  // chậm nhất, KHÔNG cộng các công đoạn lại (xem rollUpWorkOrder).
  await rollUpWorkOrder(workOrderId)

  const num = (jc: typeof created[number]) => ({
    ...jc, plannedQty: jc.plannedQty === null ? null : Number(jc.plannedQty),
    actualQty: jc.actualQty === null ? null : Number(jc.actualQty),
  })
  return successResponse({
    jobCard: num(created[0]),
    jobCards: created.map(num),
    message: created.length > 1
      ? `Đã tạo ${created.length} phiếu — mỗi công đoạn một phiếu`
      : `Đã tạo phiếu ${created[0].jobCode}`,
  })
}
