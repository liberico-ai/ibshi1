import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { respondMeetingSchema } from '@/lib/schemas'
import { respondInvite } from '@/lib/meeting-engine'

export const dynamic = 'force-dynamic'

// POST /api/work/meetings/[id]/respond — xác nhận tham gia / từ chối
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const result = await validateBody(req, respondMeetingSchema)
    if (!result.success) return result.response
    await respondInvite(id, payload.userId, result.data.status, result.data.note)
    return successResponse({}, 'Đã ghi nhận phản hồi')
  } catch (err) {
    console.error('POST /api/work/meetings/[id]/respond error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi hệ thống', 400)
  }
}
