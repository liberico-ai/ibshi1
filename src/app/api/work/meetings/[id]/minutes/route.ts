import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { closeMeetingSchema } from '@/lib/schemas'
import { closeMeeting } from '@/lib/meeting-engine'

export const dynamic = 'force-dynamic'

// POST /api/work/meetings/[id]/minutes — lưu biên bản họp & kết thúc (chỉ người tạo)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const result = await validateBody(req, closeMeetingSchema)
    if (!result.success) return result.response
    await closeMeeting(id, payload.userId, result.data)
    return successResponse({}, 'Đã lưu biên bản & kết thúc cuộc họp')
  } catch (err) {
    console.error('POST /api/work/meetings/[id]/minutes error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi hệ thống', 400)
  }
}
