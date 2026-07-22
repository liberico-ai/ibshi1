import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import prisma from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/work/revise/eligibility?projectId=..
// Dự án có mở được vòng revise không? (guard UX cho fork — tránh throw lỗi kỹ thuật)
// Điều kiện = openRevisionRound suy được template: có ≥1 task template-driven của dự án.
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const projectId = new URL(req.url).searchParams.get('projectId')
    if (!projectId) return errorResponse('Thiếu projectId', 400)

    const anyTplTask = await prisma.task.findFirst({
      where: { projectId, NOT: { templateStepId: null } },
      select: { templateStepId: true },
    })
    if (!anyTplTask?.templateStepId) {
      return successResponse({
        eligible: false,
        reason: 'Dự án chưa chạy theo quy trình mẫu (process-template) — chưa mở được vòng revise. Cần đưa dự án lên hệ template trước.',
      })
    }
    const ts = await prisma.templateStep.findUnique({
      where: { id: anyTplTask.templateStepId },
      select: { template: { select: { name: true } } },
    })
    return successResponse({ eligible: true, templateName: ts?.template?.name ?? null })
  } catch (err) {
    console.error('GET /api/work/revise/eligibility error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi hệ thống', 400)
  }
}
