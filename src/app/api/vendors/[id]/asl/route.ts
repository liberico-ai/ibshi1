import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles, logAudit, getClientIP } from '@/lib/auth'

export const dynamic = 'force-dynamic'
// WIP-09: duyệt ASL / đánh giá NCC — GĐ dự án (R02) / TP.TM (R07) / BGĐ (R01) / Admin.
const MANAGE = ['R01', 'R02', 'R07', 'R07a', 'R10']
const VIOLATION_ROLES = ['R01', 'R05', 'R05a', 'R07', 'R07a', 'R09', 'R09a', 'R10']
const ASL_STATUSES = new Set(['NONE', 'TRIAL', 'APPROVED', 'SUSPENDED', 'REMOVED'])

// GET — trạng thái ASL + lịch sử đánh giá + sổ vi phạm của NCC.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const { id } = await params
    const v = await prisma.vendor.findUnique({
      where: { id },
      select: {
        id: true, name: true, aslStatus: true, aslApprovedAt: true, trialCount: true,
        evaluations: { orderBy: { evaluatedAt: 'desc' }, take: 20 },
        violations: { orderBy: { occurredAt: 'desc' }, take: 50 },
      },
    })
    if (!v) return errorResponse('Không tìm thấy NCC', 404)
    return successResponse({
      id: v.id, name: v.name, aslStatus: v.aslStatus, aslApprovedAt: v.aslApprovedAt, trialCount: v.trialCount,
      evaluations: v.evaluations, violations: v.violations,
      openViolations: v.violations.filter(x => x.status === 'OPEN').length,
    })
  } catch (err) {
    console.error('GET vendor asl error:', err)
    return errorResponse('Lỗi tải ASL/đánh giá NCC', 500)
  }
}

// POST — action: evaluate | setAsl | addViolation | resolveViolation.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const { id } = await params
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const action = String(b.action || '')
    const vendor = await prisma.vendor.findUnique({ where: { id }, select: { id: true, name: true, trialCount: true } })
    if (!vendor) return errorResponse('Không tìm thấy NCC', 404)

    if (action === 'evaluate') {
      if (!requireRoles(user.roleCode, MANAGE)) return errorResponse('Không có quyền đánh giá NCC', 403)
      const n = (k: string) => Math.max(0, Math.min(5, Number(b[k] || 0)))
      const scores = { scoreContactPrice: n('scoreContactPrice'), scoreQuality: n('scoreQuality'), scoreDelivery: n('scoreDelivery'), scoreExclusive: n('scoreExclusive'), scoreAttitude: n('scoreAttitude') }
      const flags = { isCustomerDesignated: !!b.isCustomerDesignated, hasIso9001: !!b.hasIso9001, sampleEvalPassed: !!b.sampleEvalPassed }
      // Kết luận tự động: trung bình 5 điểm >= 3 và mẫu đạt (hoặc khách chỉ định) → PASS.
      const avg = (scores.scoreContactPrice + scores.scoreQuality + scores.scoreDelivery + scores.scoreExclusive + scores.scoreAttitude) / 5
      const overallResult = (avg >= 3 && (flags.sampleEvalPassed || flags.isCustomerDesignated)) ? 'PASS' : 'FAIL'
      const decision = b.decision ? String(b.decision) : null
      const ev = await prisma.supplierEvaluation.create({ data: { vendorId: id, evaluatedBy: user.userId, ...scores, ...flags, overallResult, decision, note: b.note ? String(b.note) : null }, select: { id: true } })
      await logAudit(user.userId, 'VENDOR_EVALUATE', 'Vendor', id, { name: vendor.name, overallResult, avg }, getClientIP(req))
      return successResponse({ evaluationId: ev.id, overallResult }, `Đã đánh giá NCC: ${overallResult === 'PASS' ? 'Đạt' : 'Chưa đạt'}`)
    }

    if (action === 'setAsl') {
      if (!requireRoles(user.roleCode, MANAGE)) return errorResponse('Không có quyền duyệt ASL', 403)
      const status = String(b.status || '')
      if (!ASL_STATUSES.has(status)) return errorResponse('Trạng thái ASL không hợp lệ', 400)
      await prisma.vendor.update({ where: { id }, data: { aslStatus: status, aslApprovedAt: status === 'APPROVED' ? new Date() : null, aslApprovedBy: status === 'APPROVED' ? user.userId : null } })
      await logAudit(user.userId, 'VENDOR_ASL_SET', 'Vendor', id, { name: vendor.name, status }, getClientIP(req))
      return successResponse({ id, aslStatus: status }, `Đã đặt ASL: ${status}`)
    }

    if (action === 'incTrial') {
      if (!requireRoles(user.roleCode, MANAGE)) return errorResponse('Không có quyền', 403)
      const newCount = vendor.trialCount + 1
      // Đủ 3 lần mua thử → gợi ý lên TRIAL nếu chưa APPROVED.
      await prisma.vendor.update({ where: { id }, data: { trialCount: newCount, aslStatus: newCount >= 3 ? 'TRIAL' : undefined } })
      return successResponse({ id, trialCount: newCount }, `Đã ghi lần mua thử #${newCount}${newCount >= 3 ? ' — đủ 3 lần, có thể xét vào ASL' : ''}`)
    }

    if (action === 'addViolation') {
      if (!requireRoles(user.roleCode, VIOLATION_ROLES)) return errorResponse('Không có quyền ghi vi phạm', 403)
      const description = String(b.description || '').trim()
      if (!description) return errorResponse('Cần mô tả vi phạm', 400)
      const severity = ['MINOR', 'MAJOR', 'CRITICAL'].includes(String(b.severity)) ? String(b.severity) : 'MINOR'
      const vio = await prisma.supplierViolation.create({ data: { vendorId: id, description, severity, createdBy: user.userId, note: b.note ? String(b.note) : null }, select: { id: true } })
      await logAudit(user.userId, 'VENDOR_VIOLATION_ADD', 'Vendor', id, { name: vendor.name, severity }, getClientIP(req))
      return successResponse({ violationId: vio.id }, 'Đã ghi vi phạm NCC')
    }

    if (action === 'resolveViolation') {
      if (!requireRoles(user.roleCode, VIOLATION_ROLES)) return errorResponse('Không có quyền', 403)
      const vid = String(b.violationId || '')
      if (!vid) return errorResponse('Thiếu violationId', 400)
      await prisma.supplierViolation.update({ where: { id: vid }, data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: user.userId } })
      return successResponse({ violationId: vid }, 'Đã xử lý vi phạm')
    }

    return errorResponse('action không hợp lệ', 400)
  } catch (err) {
    console.error('POST vendor asl error:', err)
    return errorResponse('Lỗi thao tác ASL/đánh giá NCC', 500)
  }
}
