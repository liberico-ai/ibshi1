import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const CAN = ['R01', 'R02', 'R07', 'R07a', 'R08', 'R08a', 'R10']

/**
 * PATCH /api/procurement/payment-schedules/[id]
 * body: { status?, paidAmount?, paidDate?, ... } — cập nhật trạng thái/thanh toán.
 * status PAID → tự ghi paidDate nếu chưa có.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!CAN.includes(payload.roleCode)) return errorResponse('Không có quyền', 403)
    const { id } = await params
    const b = await req.json().catch(() => ({})) as Record<string, string | number | undefined>

    const data: Record<string, unknown> = {}
    if (b.status) data.status = String(b.status)
    if (b.paidAmount !== undefined) data.paidAmount = Number(b.paidAmount) || 0
    if (b.paidDate !== undefined) data.paidDate = b.paidDate ? new Date(String(b.paidDate)) : null
    if (b.paymentMethod !== undefined) data.paymentMethod = b.paymentMethod ? String(b.paymentMethod) : null
    if (b.value !== undefined) data.value = Number(b.value) || 0
    if (b.notes !== undefined) data.notes = b.notes ? String(b.notes) : null
    // status PAID mà chưa có ngày trả → ghi hôm nay
    if (b.status === 'PAID' && b.paidDate === undefined) data.paidDate = new Date()
    if (Object.keys(data).length === 0) return errorResponse('Không có dữ liệu cập nhật', 400)

    await prisma.paymentSchedule.update({ where: { id }, data })
    return successResponse({ id })
  } catch (err) {
    console.error('PATCH payment-schedule error:', err)
    return errorResponse('Lỗi cập nhật', 500)
  }
}

/** DELETE — xoá 1 dòng lịch thanh toán */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!CAN.includes(payload.roleCode)) return errorResponse('Không có quyền', 403)
    const { id } = await params
    await prisma.paymentSchedule.delete({ where: { id } })
    return successResponse({ id })
  } catch (err) {
    console.error('DELETE payment-schedule error:', err)
    return errorResponse('Lỗi xoá', 500)
  }
}
