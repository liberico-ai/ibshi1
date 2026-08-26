import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/procurement/my-approvals — "Việc chờ tôi duyệt" gom theo VAI TRÒ người đăng nhập.
 * Trả các nhóm việc đang chờ đúng người này ký/duyệt: PR, điều kiện TT HĐ, đề nghị thanh toán, MTC/QC.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const role = user.roleCode
    const groups: Array<{ key: string; label: string; count: number; link: string }> = []

    // 1) PR chờ duyệt (TP Thương mại / GĐ dự án / BGĐ).
    if (['R07', 'R02', 'R01', 'R10'].includes(role)) {
      const c = await prisma.purchaseRequest.count({ where: { status: 'PENDING' } })
      if (c > 0) groups.push({ key: 'pr', label: 'PR chờ duyệt', count: c, link: '/dashboard/warehouse/kiem-tra-ton-kho' })
    }
    // 2) Điều kiện thanh toán HĐ chờ CHỐT của tôi.
    const ptSlot = ['R08', 'R08a'].includes(role) ? 'ptFinanceBy' : role === 'R03' ? 'ptKtktBy' : role === 'R01' ? 'ptBodBy' : null
    if (ptSlot) {
      const c = await prisma.purchaseContract.count({ where: { paymentTermsStatus: 'PENDING', [ptSlot]: null } })
      if (c > 0) groups.push({ key: 'pt', label: 'HĐ chờ tôi ký điều kiện TT', count: c, link: '/dashboard/warehouse/hop-dong' })
    }
    // 3) Đề nghị thanh toán chờ CHỐT của tôi (đúng trình tự QLDA→TP.TM/KTT→GĐDA).
    if (['R02', 'R02a'].includes(role)) {
      const c = await prisma.paymentRequest.count({ where: { status: 'PENDING', qldaBy: null } })
      if (c > 0) groups.push({ key: 'pay-qlda', label: 'Thanh toán chờ QLDA kiểm', count: c, link: '/dashboard/warehouse/de-nghi-thanh-toan' })
    }
    if (['R07', 'R07a', 'R08'].includes(role)) {
      const c = await prisma.paymentRequest.count({ where: { status: 'PENDING', qldaBy: { not: null }, tmkttBy: null } })
      if (c > 0) groups.push({ key: 'pay-tmktt', label: 'Thanh toán chờ TP.TM/KTT soát', count: c, link: '/dashboard/warehouse/de-nghi-thanh-toan' })
    }
    if (role === 'R01') {
      const c = await prisma.paymentRequest.count({ where: { status: 'PENDING', qldaBy: { not: null }, tmkttBy: { not: null }, gddaBy: null } })
      if (c > 0) groups.push({ key: 'pay-gdda', label: 'Thanh toán chờ GĐ dự án duyệt', count: c, link: '/dashboard/warehouse/de-nghi-thanh-toan' })
    }
    if (['R08', 'R08a'].includes(role)) {
      const c = await prisma.paymentRequest.count({ where: { status: 'APPROVED' } })
      if (c > 0) groups.push({ key: 'pay-do', label: 'Thanh toán đã duyệt — chờ chi trả', count: c, link: '/dashboard/warehouse/de-nghi-thanh-toan' })
    }
    // 4) MTC / nghiệm thu (QC).
    if (['R09', 'R09a'].includes(role)) {
      const c = await prisma.purchaseContract.count({ where: { status: { not: 'CANCELLED' }, mtcStatus: 'PENDING', OR: [{ arrivedDate: { not: null } }, { goodsReceipts: { some: {} } }] } })
      if (c > 0) groups.push({ key: 'mtc', label: 'HĐ chờ chấp nhận MTC / nghiệm thu', count: c, link: '/dashboard/warehouse/hang-ve-qc' })
    }

    const total = groups.reduce((s, g) => s + g.count, 0)
    return successResponse({ total, groups })
  } catch (err) {
    console.error('GET my-approvals error:', err)
    return errorResponse('Lỗi tải việc chờ duyệt', 500)
  }
}
