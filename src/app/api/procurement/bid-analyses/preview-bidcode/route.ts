import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { projShort, yymmOf, generateNextBidCode } from '@/lib/bidcode'

export const dynamic = 'force-dynamic'

/**
 * GET /api/procurement/bid-analyses/preview-bidcode?projectCode=&materialGroupCode=&urgent=
 * Xem trước mã BID sẽ sinh (KHÔNG ghi DB) — khớp Commerce previewBidCode.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const sp = req.nextUrl.searchParams
    const projectCode = sp.get('projectCode') || ''
    if (!projectCode) return errorResponse('Thiếu projectCode', 400)
    const mat = sp.get('materialGroupCode') || 'ALL'
    const urgent = sp.get('urgent') === '1' || sp.get('urgent') === 'true'
    const gen = await generateNextBidCode(prisma, { projShort: projShort(projectCode), yymm: yymmOf(), mat, urgent })
    return successResponse({ bidCode: gen.code, seq: gen.seq })
  } catch (err) {
    console.error('GET preview-bidcode error:', err)
    return errorResponse('Lỗi xem trước mã BID', 500)
  }
}
