import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { commentSchema } from '@/lib/schemas'
import { addComment } from '@/lib/work-engine'

export const dynamic = 'force-dynamic'

// POST /api/work/tasks/[id]/comments — trao đổi trên task
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const result = await validateBody(req, commentSchema)
    if (!result.success) return result.response
    const c = await addComment(id, payload.userId, result.data.content)
    return successResponse({ comment: c }, 'Đã gửi', 201)
  } catch (err) {
    console.error('POST /api/work/tasks/[id]/comments error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
