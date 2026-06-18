import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import prisma from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id: taskId } = await params
    const { docId } = await req.json()
    if (!docId || typeof docId !== 'string') return errorResponse('docId bắt buộc', 400)

    const doc = await prisma.taskDocRequirement.findFirst({
      where: { id: docId, taskId, kind: 'MUST_READ' },
    })
    if (!doc) return errorResponse('Tài liệu không tồn tại', 404)

    await prisma.taskDocAck.upsert({
      where: { requirementId_userId: { requirementId: docId, userId: payload.userId } },
      update: {},
      create: { requirementId: docId, userId: payload.userId },
    })

    return successResponse({}, 'Đã ghi nhận')
  } catch (err) {
    console.error('POST /api/work/tasks/[id]/ack-doc error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
