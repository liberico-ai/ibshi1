import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { emitDepartmentsChanged } from '@/lib/webhook'

export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (user.roleCode !== 'R10') return errorResponse('Chỉ R10 (Admin) được dùng', 403)

  const body = await req.json().catch(() => ({}))
  const summary = typeof body.summary === 'string' ? body.summary : 'Departments updated'

  await emitDepartmentsChanged(summary)

  return successResponse({ sent: true }, 'Đã gửi webhook departments.changed')
}
