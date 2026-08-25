import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles, logAudit, getClientIP } from '@/lib/auth'
import { PROCUREMENT_MILESTONES, MILESTONE_LABEL } from '@/lib/procurement-milestones'

export const dynamic = 'force-dynamic'
const CAN = ['R01', 'R02', 'R07', 'R07a', 'R10']

/**
 * #6 — Ghi nhận thời điểm 15 mốc quy trình mua sắm cho 1 BID (record-only).
 * GET  → 15 mốc kèm thời điểm đã ghi (nếu có).
 * POST { milestoneNo, occurredAt?, note } → upsert (ghi/cập nhật thời điểm; mặc định = hiện tại).
 * DELETE ?milestoneNo= → xoá mốc đã ghi.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const { id } = await params
    const recorded = await prisma.procurementMilestone.findMany({ where: { bidAnalysisId: id }, select: { milestoneNo: true, occurredAt: true, note: true } })
    const map = new Map(recorded.map(r => [r.milestoneNo, r]))
    const milestones = PROCUREMENT_MILESTONES.map(m => ({ no: m.no, label: m.label, phase: m.phase, occurredAt: map.get(m.no)?.occurredAt || null, note: map.get(m.no)?.note || null }))
    return successResponse({ milestones, recordedCount: recorded.length })
  } catch (err) {
    console.error('GET milestones error:', err)
    return errorResponse('Lỗi tải mốc thời gian', 500)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, CAN)) return errorResponse('Không có quyền ghi mốc', 403)
    const { id } = await params
    const b = await req.json().catch(() => ({})) as { milestoneNo?: number; occurredAt?: string; note?: string }
    const no = Number(b.milestoneNo)
    if (!MILESTONE_LABEL[no]) return errorResponse('milestoneNo không hợp lệ (1-15)', 400)
    const occurredAt = b.occurredAt ? new Date(b.occurredAt) : new Date()
    await prisma.procurementMilestone.upsert({
      where: { bidAnalysisId_milestoneNo: { bidAnalysisId: id, milestoneNo: no } },
      create: { bidAnalysisId: id, milestoneNo: no, occurredAt, note: b.note || null, recordedBy: user.userId },
      update: { occurredAt, note: b.note ?? undefined, recordedBy: user.userId },
    })
    await logAudit(user.userId, 'PROCUREMENT_MILESTONE', 'BidAnalysis', id, { milestoneNo: no, label: MILESTONE_LABEL[no] }, getClientIP(req))
    return successResponse({ milestoneNo: no, occurredAt }, `Đã ghi mốc ${no}: ${MILESTONE_LABEL[no]}`)
  } catch (err) {
    console.error('POST milestone error:', err)
    return errorResponse('Lỗi ghi mốc', 500)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, CAN)) return errorResponse('Không có quyền', 403)
    const { id } = await params
    const no = Number(req.nextUrl.searchParams.get('milestoneNo'))
    if (!no) return errorResponse('Thiếu milestoneNo', 400)
    await prisma.procurementMilestone.deleteMany({ where: { bidAnalysisId: id, milestoneNo: no } })
    return successResponse({ milestoneNo: no }, 'Đã xoá mốc')
  } catch (err) {
    console.error('DELETE milestone error:', err)
    return errorResponse('Lỗi xoá mốc', 500)
  }
}
