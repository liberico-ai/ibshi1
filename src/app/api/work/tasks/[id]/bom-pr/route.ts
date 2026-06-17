import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// POST /api/work/tasks/[id]/bom-pr  { data: string }  — lưu dữ liệu PR (BomPrUploadUI) vào task
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const body = await req.json().catch(() => ({})) as { data?: string }
    const task = await prisma.task.findUnique({ where: { id }, select: { resultData: true } })
    if (!task) return errorResponse('Không tìm thấy công việc', 404)
    const prev = (task.resultData && typeof task.resultData === 'object') ? (task.resultData as Record<string, unknown>) : {}
    await prisma.task.update({ where: { id }, data: { resultData: JSON.parse(JSON.stringify({ ...prev, bomPr: body.data || '' })) } })
    return successResponse({})
  } catch (err) {
    console.error('POST /api/work/tasks/[id]/bom-pr error:', err)
    return errorResponse('Lỗi lưu PR', 500)
  }
}
