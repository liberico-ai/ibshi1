import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createMeetingSchema } from '@/lib/schemas'
import { createMeeting, getMeetings } from '@/lib/meeting-engine'

export const dynamic = 'force-dynamic'

// GET /api/work/meetings — họp tôi tạo hoặc được mời
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const meetings = await getMeetings(payload.userId)
    return successResponse({ meetings })
  } catch (err) {
    console.error('GET /api/work/meetings error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/work/meetings — tạo cuộc họp + mời người
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const result = await validateBody(req, createMeetingSchema)
    if (!result.success) return result.response
    const meeting = await createMeeting(result.data, payload.userId)
    return successResponse({ meeting }, 'Đã tạo cuộc họp & gửi lời mời', 201)
  } catch (err) {
    console.error('POST /api/work/meetings error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi hệ thống', 400)
  }
}
