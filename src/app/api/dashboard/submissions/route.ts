import { NextRequest } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { emitProjectApproved, emitProjectRejected } from '@/lib/webhook'

const REVIEWER_ROLES = ['R01', 'R02', 'R10']

export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!REVIEWER_ROLES.includes(user.roleCode)) {
    return errorResponse('Không có quyền xem danh sách submission', 403)
  }

  const status = req.nextUrl.searchParams.get('status') || undefined

  const where: Record<string, unknown> = {}
  if (status) where.status = status

  const submissions = await prisma.projectSubmission.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return successResponse({
    submissions: submissions.map(s => ({
      id: s.id,
      externalRef: s.externalRef,
      status: s.status,
      payload: s.payload,
      saleCustomerId: s.saleCustomerId,
      projectId: s.projectId,
      projectCode: s.projectCode,
      reason: s.reason,
      reviewedBy: s.reviewedBy,
      reviewedAt: s.reviewedAt,
      createdAt: s.createdAt,
    })),
  })
}

const approveSchema = z.object({
  action: z.enum(['approve', 'reject']),
  submissionId: z.string().min(1),
  projectCode: z.string().optional(),
  reason: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!REVIEWER_ROLES.includes(user.roleCode)) {
    return errorResponse('Không có quyền duyệt submission', 403)
  }

  const body = await req.json()
  const parsed = approveSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse(parsed.error.issues.map(i => i.message).join('; '), 400)
  }

  const { action, submissionId, projectCode, reason } = parsed.data

  const sub = await prisma.projectSubmission.findUnique({ where: { id: submissionId } })
  if (!sub) return errorResponse('Submission không tồn tại', 404)
  if (sub.status !== 'UNDER_REVIEW') {
    return errorResponse(`Submission đã được xử lý (${sub.status})`, 400)
  }

  const payload = (sub.payload && typeof sub.payload === 'object') ? (sub.payload as Record<string, unknown>) : {}

  if (action === 'approve') {
    if (!projectCode) return errorResponse('Cần nhập projectCode khi duyệt', 400)

    const codeExists = await prisma.project.findUnique({ where: { projectCode } })
    if (codeExists) return errorResponse(`projectCode "${projectCode}" đã tồn tại`, 409)

    const project = await prisma.project.create({
      data: {
        projectCode,
        projectName: typeof payload.projectName === 'string' ? payload.projectName : sub.externalRef,
        clientName: typeof payload.clientName === 'string' ? payload.clientName : 'N/A',
        productType: typeof payload.productType === 'string' ? payload.productType : 'OTHER',
        projectType: typeof payload.projectType === 'string' ? payload.projectType : 'OTHER',
        contractValue: typeof payload.contractValue === 'number' ? payload.contractValue : null,
        currency: typeof payload.currency === 'string' ? payload.currency : 'VND',
        description: typeof payload.description === 'string' ? payload.description : null,
        saleCustomerId: sub.saleCustomerId,
        status: 'ACTIVE',
      },
    })

    await prisma.projectSubmission.update({
      where: { id: submissionId },
      data: {
        status: 'APPROVED',
        projectId: project.id,
        projectCode,
        reviewedBy: user.userId,
        reviewedAt: new Date(),
      },
    })

    emitProjectApproved(submissionId).catch(() => {})

    return successResponse({
      submission: { id: sub.id, status: 'APPROVED', projectId: project.id, projectCode },
    }, 'Đã duyệt và tạo dự án')
  }

  // action === 'reject'
  await prisma.projectSubmission.update({
    where: { id: submissionId },
    data: {
      status: 'REJECTED',
      reason: reason || null,
      reviewedBy: user.userId,
      reviewedAt: new Date(),
    },
  })

  emitProjectRejected(submissionId).catch(() => {})

  return successResponse({
    submission: { id: sub.id, status: 'REJECTED', reason },
  }, 'Đã từ chối submission')
}
