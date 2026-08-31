import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createItpSchema } from '@/lib/schemas'
import { getProjectIdsOfPm } from '@/lib/project-pm'

// GET /api/qc/itp — List ITPs
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId') || undefined
  const status = url.searchParams.get('status') || undefined

  const where: Record<string, unknown> = {}
  if (projectId) where.projectId = projectId
  if (status) where.status = status

  const itps = await prisma.inspectionTestPlan.findMany({
    where,
    include: {
      project: { select: { projectCode: true, projectName: true } },
      checkpoints: { orderBy: { sortOrder: 'asc' } },
      // Lệnh mà ITP này kiểm tra, kèm các phiếu xưởng đã báo — để thẻ ITP nói rõ kiểm tra cái gì.
      workOrder: {
        select: {
          id: true, woCode: true, description: true, pieceMark: true, teamCode: true,
          plannedWeight: true, completedQty: true,
          jobCards: { select: { actualQty: true, workDate: true }, orderBy: { workDate: 'desc' } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Biên bản nghiệm thu đính theo từng điểm kiểm (FileAttachment không có quan hệ trực tiếp,
  // tra bằng entityType + entityId nên phải lấy rời rồi ghép).
  const cpIds = itps.flatMap(itp => itp.checkpoints.map(cp => cp.id))
  const files = cpIds.length > 0
    ? await prisma.fileAttachment.findMany({
        where: { entityType: 'ITPCheckpoint', entityId: { in: cpIds } },
        select: { id: true, entityId: true, fileName: true, fileUrl: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      })
    : []
  const filesByCp = files.reduce<Record<string, typeof files>>((acc, f) => {
    (acc[f.entityId] ||= []).push(f)
    return acc
  }, {})

  // Tên người đã ký hai vai QAQC / PM
  const signerIds = [...new Set(itps.flatMap(itp =>
    itp.checkpoints.flatMap(cp => [cp.qcConfirmedBy, cp.pmConfirmedBy]).filter(Boolean) as string[]
  ))]
  const signers = signerIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: signerIds } }, select: { id: true, fullName: true } })
    : []
  const nameOf = new Map(signers.map(u => [u.id, u.fullName]))

  // Người đang xem ký được vai nào — giao diện dựa vào đây để hiện nút, không tự đoán theo role.
  // Ký nghiệm thu: CHỈ Trưởng phòng QAQC (R09) và PM phụ trách dự án.
  // Chấm lỗi: kiểm tra viên (R09a) cũng được — phát hiện lỗi là việc của họ.
  const canQcSign = user.roleCode === 'R09'
  const canFlagFail = ['R09', 'R09a'].includes(user.roleCode)
  const pmProjectIds = new Set(await getProjectIdsOfPm(user.userId))

  const result = itps.map(itp => {
    const wo = itp.workOrder
    const cards = wo?.jobCards || []
    const reportedQty = cards.reduce((s, c) => s + Number(c.actualQty || 0), 0)
    return {
      ...itp,
      canQcSign,
      canPmSign: pmProjectIds.has(itp.projectId),
      canFlagFail: canFlagFail || pmProjectIds.has(itp.projectId),
      checkpoints: itp.checkpoints.map(cp => ({
        ...cp,
        attachments: filesByCp[cp.id] || [],
        qcConfirmedName: cp.qcConfirmedBy ? nameOf.get(cp.qcConfirmedBy) ?? null : null,
        pmConfirmedName: cp.pmConfirmedBy ? nameOf.get(cp.pmConfirmedBy) ?? null : null,
      })),
      totalCheckpoints: itp.checkpoints.length,
      passedCheckpoints: itp.checkpoints.filter(cp => cp.status === 'PASSED').length,
      failedCheckpoints: itp.checkpoints.filter(cp => cp.status === 'FAILED').length,
      workOrder: wo ? {
        id: wo.id, woCode: wo.woCode, description: wo.description,
        pieceMark: wo.pieceMark, teamCode: wo.teamCode,
        plannedWeight: wo.plannedWeight ? Number(wo.plannedWeight) : null,
        reportedQty,
        // Ngày hoàn thành = lần báo gần nhất của lệnh
        lastReportDate: cards[0]?.workDate ?? null,
        reportCount: cards.length,
      } : null,
    }
  })

  return successResponse({ itps: result })
}

// POST /api/qc/itp — Create ITP
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01', 'R09', 'R09a'])) {
    return errorResponse('Không có quyền tạo ITP', 403)
  }

  const result = await validateBody(req, createItpSchema)
  if (!result.success) return result.response
  const { projectId, name, workOrderId, inspectionDate, checkpoints } = result.data

  // ITP gắn với một lệnh sản xuất: lệnh phải thuộc đúng dự án đang chọn.
  let woOfItp: { id: string; woCode: string; pieceMark: string | null; description: string; projectId: string } | null = null
  if (workOrderId) {
    woOfItp = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: { id: true, woCode: true, pieceMark: true, description: true, projectId: true },
    })
    if (!woOfItp) return errorResponse('Không tìm thấy lệnh sản xuất')
    if (woOfItp.projectId !== projectId) {
      return errorResponse('Lệnh sản xuất không thuộc dự án đã chọn')
    }
  }

  const year = new Date().getFullYear().toString().slice(-2)
  const count = await prisma.inspectionTestPlan.count()
  const itpCode = `ITP-${year}-${String(count + 1).padStart(3, '0')}`

  const woIds = [...new Set(checkpoints?.map(cp => cp.workOrderId).filter(Boolean) as string[] || [])]
  const woMap = new Map<string, string | null>()
  if (woIds.length > 0) {
    const wos = await prisma.workOrder.findMany({ where: { id: { in: woIds } }, select: { id: true, pieceMark: true } })
    wos.forEach(wo => woMap.set(wo.id, wo.pieceMark))
  }

  // Màn tạo ITP không nhập điểm kiểm tra nữa. Vẫn sinh MỘT điểm gắn với lệnh, vì toàn bộ
  // luồng phía sau (Đạt/Lỗi, tự mở NCR, đếm tiến độ) chạy trên checkpoint — không có thì ITP nằm chết.
  const autoCheckpoint = !checkpoints?.length && woOfItp
    ? [{
        checkpointNo: 1,
        activity: 'visual',
        description: `Kiểm tra ${woOfItp.woCode}${woOfItp.description ? ` — ${woOfItp.description}` : ''}`,
        standard: null,
        acceptCriteria: null,
        inspectionType: 'MONITOR',
        sortOrder: 1,
        workOrderId: woOfItp.id,
        pieceMark: woOfItp.pieceMark,
      }]
    : null

  const itp = await prisma.inspectionTestPlan.create({
    data: {
      itpCode, projectId, name,
      workOrderId: workOrderId || null,
      inspectionDate: inspectionDate ? new Date(inspectionDate) : null,
      checkpoints: checkpoints && checkpoints.length > 0 ? {
        create: checkpoints.map((cp, i) => ({
          checkpointNo: cp.checkpointNo ?? i + 1,
          activity: cp.activity,
          description: cp.description,
          standard: cp.standard || null,
          acceptCriteria: cp.acceptCriteria || null,
          inspectionType: cp.inspectionType || 'MONITOR',
          sortOrder: i + 1,
          workOrderId: cp.workOrderId || null,
          pieceMark: cp.pieceMark || (cp.workOrderId ? woMap.get(cp.workOrderId) ?? null : null),
        })),
      } : autoCheckpoint ? { create: autoCheckpoint } : undefined,
    },
    include: { checkpoints: true },
  })

  return successResponse({ itp, message: 'Đã tạo ITP' })
}
