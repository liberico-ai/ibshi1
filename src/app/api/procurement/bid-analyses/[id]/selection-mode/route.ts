import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const CAN = ['R01', 'R02', 'R07', 'R07a', 'R10']
const MODES = ['PER_BID', 'PER_ITEM', 'PER_GROUP', 'AUTO_MIN_PRICE', 'MANUAL_WEIGHTED']

/** PATCH /api/procurement/bid-analyses/[id]/selection-mode  body: { selectionMode } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!CAN.includes(payload.roleCode)) return errorResponse('Không có quyền', 403)
    const { id } = await params
    const body = await req.json().catch(() => ({})) as { selectionMode?: string }
    if (!body.selectionMode || !MODES.includes(body.selectionMode)) return errorResponse('selectionMode không hợp lệ', 400)
    await prisma.bidAnalysis.update({ where: { id }, data: { selectionMode: body.selectionMode } })
    return successResponse({ selectionMode: body.selectionMode })
  } catch (err) {
    console.error('PATCH selection-mode error:', err)
    return errorResponse('Lỗi đổi chế độ', 500)
  }
}
