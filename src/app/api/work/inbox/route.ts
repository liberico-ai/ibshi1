import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { validateQuery } from '@/lib/api-helpers'
import { inboxQuerySchema } from '@/lib/schemas'
import { getInbox } from '@/lib/work-engine'

export const dynamic = 'force-dynamic'

// GET /api/work/inbox?tab=assigned|dept|created|overdue&page=
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const q = validateQuery(req.url, inboxQuerySchema)
    if (!q.success) return q.response
    const data = await getInbox(payload.userId, payload.roleCode, q.data.tab, q.data.page, { q: q.data.q, projectId: q.data.projectId })
    return successResponse(data)
  } catch (err) {
    console.error('GET /api/work/inbox error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
