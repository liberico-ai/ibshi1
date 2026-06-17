import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { getMeetingDetail } from '@/lib/meeting-engine'

export const dynamic = 'force-dynamic'

// GET /api/work/meetings/[id] — chi tiết cuộc họp + người dự + RSVP + tài liệu
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const meeting = await getMeetingDetail(id)
    if (!meeting) return errorResponse('Không tìm thấy cuộc họp', 404)
    return successResponse({ meeting })
  } catch (err) {
    console.error('GET /api/work/meetings/[id] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
