import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createTaskSchema } from '@/lib/schemas'
import { createTask } from '@/lib/work-engine'

export const dynamic = 'force-dynamic'

// POST /api/work/tasks/[id]/subtasks — tạo việc con (LV3+)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const result = await validateBody(req, createTaskSchema)
    if (!result.success) return result.response
    const task = await createTask({ ...result.data, parentId: id }, payload.userId)
    return successResponse({ task }, 'Đã tạo việc con', 201)
  } catch (err) {
    console.error('POST /api/work/tasks/[id]/subtasks error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi hệ thống', 500)
  }
}
