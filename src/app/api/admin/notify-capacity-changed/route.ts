import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { emitCapacityChanged } from '@/lib/webhook'

export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!['R01', 'R02', 'R10'].includes(user.roleCode)) {
    return errorResponse('Không có quyền', 403)
  }

  const body = await req.json().catch(() => ({}))
  const changeType = typeof body.changeType === 'string' ? body.changeType : 'manual'
  const summary = typeof body.summary === 'string' ? body.summary : 'Capacity changed'

  await emitCapacityChanged(changeType, summary)

  return successResponse({ sent: true }, 'Đã gửi webhook capacity.changed')
}
