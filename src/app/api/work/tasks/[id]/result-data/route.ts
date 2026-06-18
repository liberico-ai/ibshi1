import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const ALLOWED_KEYS = ['bomPr', 'momAttendants', 'momSections', 'momHeader', 'templateType', 'weldData', 'paintData', 'totalMaterial', 'totalLabor', 'totalService', 'totalOverhead', 'totalEstimate', 'dt02Detail', 'estimateFileName']

// POST /api/work/tasks/[id]/result-data  { key, value }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const body = await req.json().catch(() => ({})) as { key?: string; value?: unknown }
    if (!body.key || !ALLOWED_KEYS.includes(body.key)) return errorResponse('Key không hợp lệ', 400)

    const task = await prisma.task.findUnique({ where: { id }, select: { resultData: true } })
    if (!task) return errorResponse('Không tìm thấy công việc', 404)

    const prev = (task.resultData && typeof task.resultData === 'object') ? (task.resultData as Record<string, unknown>) : {}
    await prisma.task.update({
      where: { id },
      data: { resultData: JSON.parse(JSON.stringify({ ...prev, [body.key]: body.value ?? '' })) },
    })
    return successResponse({})
  } catch (err) {
    console.error('POST /api/work/tasks/[id]/result-data error:', err)
    return errorResponse('Lỗi lưu dữ liệu', 500)
  }
}

// GET /api/work/tasks/[id]/result-data — lấy toàn bộ resultData
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const task = await prisma.task.findUnique({ where: { id }, select: { resultData: true } })
    if (!task) return errorResponse('Không tìm thấy công việc', 404)
    return successResponse({ resultData: task.resultData || {} })
  } catch (err) {
    console.error('GET /api/work/tasks/[id]/result-data error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
