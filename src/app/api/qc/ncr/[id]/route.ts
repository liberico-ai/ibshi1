import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { updateNcrSchema, createNcrActionSchema } from '@/lib/schemas'

// GET /api/qc/ncr/[id] — NCR detail with actions
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const { id } = await params
  const ncr = await prisma.nonConformanceReport.findUnique({
    where: { id },
    include: {
      project: { select: { projectCode: true, projectName: true } },
      actions: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!ncr) return errorResponse('NCR không tồn tại', 404)

  return successResponse({ ncr })
}

// PUT /api/qc/ncr/[id] — Update NCR status/disposition
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01', 'R09', 'R09a'])) {
    return errorResponse('Không có quyền cập nhật NCR', 403)
  }

  const { id } = await params
  const result = await validateBody(req, updateNcrSchema)
  if (!result.success) return result.response
  const { status, rootCause, disposition } = result.data

  const ncr = await prisma.nonConformanceReport.findUnique({
    where: { id },
    include: { actions: { select: { status: true } } },
  })
  if (!ncr) return errorResponse('NCR không tồn tại', 404)

  if (status === 'CLOSED') {
    const openActions = ncr.actions.filter(a => a.status === 'OPEN')
    if (openActions.length > 0) {
      return errorResponse(`Không thể đóng — còn ${openActions.length} action chưa hoàn thành`, 400)
    }
    if (!ncr.disposition && !disposition) {
      return errorResponse('Cần chọn disposition trước khi đóng NCR', 400)
    }
  }

  const updated = await prisma.nonConformanceReport.update({
    where: { id },
    data: {
      ...(status ? { status } : {}),
      ...(rootCause !== undefined ? { rootCause } : {}),
      ...(disposition ? { disposition } : {}),
      ...(status === 'CLOSED' ? { closedBy: user.userId, closedAt: new Date() } : {}),
    },
    include: {
      project: { select: { projectCode: true, projectName: true } },
      actions: { orderBy: { createdAt: 'asc' } },
    },
  })

  return successResponse({ ncr: updated })
}

// POST /api/qc/ncr/[id] — Add action to NCR
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01', 'R09', 'R09a', 'R06'])) {
    return errorResponse('Không có quyền thêm action', 403)
  }

  const { id } = await params
  const result = await validateBody(req, createNcrActionSchema.omit({ ncrId: true }))
  if (!result.success) return result.response
  const { actionType, description, assignedTo, dueDate } = result.data

  const ncr = await prisma.nonConformanceReport.findUnique({ where: { id } })
  if (!ncr) return errorResponse('NCR không tồn tại', 404)
  if (ncr.status === 'CLOSED' || ncr.status === 'CANCELLED') {
    return errorResponse('NCR đã đóng/hủy, không thể thêm action', 400)
  }

  const action = await prisma.ncrAction.create({
    data: {
      ncrId: id,
      actionType,
      description,
      assignedTo,
      dueDate: dueDate ? new Date(dueDate) : null,
    },
  })

  if (ncr.status === 'OPEN') {
    await prisma.nonConformanceReport.update({
      where: { id },
      data: { status: 'INVESTIGATING' },
    })
  }

  return successResponse({ action, message: 'Đã thêm action' })
}
