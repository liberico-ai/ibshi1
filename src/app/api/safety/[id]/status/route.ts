import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'

const VALID_TRANSITIONS: Record<string, string[]> = {
  OPEN: ['INVESTIGATING'],
  INVESTIGATING: ['RESOLVED', 'OPEN'],
  RESOLVED: ['CLOSED', 'INVESTIGATING'],
  CLOSED: [],
}

// POST /api/safety/[id]/status — Safety incident status transitions
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { id } = await params
    const { nextStatus, notes } = await req.json()

    if (!nextStatus) return errorResponse('Thiếu nextStatus')

    const incident = await prisma.safetyIncident.findUnique({ where: { id } })
    if (!incident) return errorResponse('Không tìm thấy sự cố', 404)

    const allowed = VALID_TRANSITIONS[incident.status] || []
    if (!allowed.includes(nextStatus)) {
      return errorResponse(`Không thể chuyển từ ${incident.status} → ${nextStatus}. Cho phép: ${allowed.join(', ') || 'không có'}`)
    }

    const updateData: Record<string, unknown> = { status: nextStatus }
    if (notes) updateData.correctiveAction = notes
    if (nextStatus === 'CLOSED') updateData.closedAt = new Date()

    const updated = await prisma.safetyIncident.update({
      where: { id },
      data: updateData,
    })

    await logAudit(user.userId, 'STATUS_CHANGE', 'SafetyIncident', id,
      { from: incident.status, to: nextStatus, incidentCode: incident.incidentCode }, getClientIP(req))

    return successResponse({ incident: updated }, `Đã chuyển ${incident.incidentCode}: ${incident.status} → ${nextStatus}`)
  } catch (err) {
    console.error('POST /api/safety/[id]/status error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
