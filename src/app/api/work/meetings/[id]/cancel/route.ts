import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { cancelMeeting } from '@/lib/meeting-engine'

export const dynamic = 'force-dynamic'

// POST /api/work/meetings/[id]/cancel — hủy cuộc họp (chỉ người tạo)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    await cancelMeeting(id, payload.userId)
    return successResponse({}, 'Đã hủy cuộc họp')
  } catch (err) {
    console.error('POST /api/work/meetings/[id]/cancel error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi hệ thống', 400)
  }
}
