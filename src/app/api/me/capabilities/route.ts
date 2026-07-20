import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, unauthorizedResponse } from '@/lib/auth'
import { getEffectiveCapabilities } from '@/lib/permissions/can'

// GET /api/me/capabilities — tập khả năng hiệu lực của user hiện tại (cho frontend ẩn/hiện).
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  const capabilities = await getEffectiveCapabilities(user)
  return successResponse({ capabilities })
}
