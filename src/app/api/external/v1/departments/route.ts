import { NextRequest } from 'next/server'
import { successResponse, errorResponse } from '@/lib/auth'
import { authenticateApiClient, requireScope } from '@/lib/api-auth'
import { DEPARTMENTS_V2 } from '@/lib/org-map'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const client = await authenticateApiClient(req)
  if (!client) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED')
  if (!requireScope(client, 'read:departments')) return errorResponse('Insufficient scope', 403, 'INSUFFICIENT_SCOPE')

  const data = DEPARTMENTS_V2.map(d => ({
    deptCode: d.code,
    displayLabel: d.name,
  }))

  return successResponse({ data })
}
