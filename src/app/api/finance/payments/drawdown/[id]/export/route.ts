import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'

const ALLOWED_ROLES = ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R08', 'R08a']

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, ALLOWED_ROLES)) return errorResponse('Forbidden', 403)

    const { id } = await params
    
    const drawdown = await prisma.loanDrawdown.findUnique({
      where: { id },
      include: { beneficiaryLines: { include: { vendor: true } } }
    })
    
    if (!drawdown) return errorResponse('Hồ sơ không tồn tại', 404)
    if (drawdown.status !== 'APPROVED' && drawdown.status !== 'EXECUTED') {
      return errorResponse('Hồ sơ phải được phê duyệt trước khi export', 400)
    }

    // Removed exportStatus update as it's not in schema
    const vpbankData = drawdown.beneficiaryLines.map((line, index) => ({
      'STT': index + 1,
      'Tài khoản trích nợ': '', // To be filled by user or system param
      'Tên người thụ hưởng': line.vendor?.name || 'N/A',
      'Số tài khoản thụ hưởng': line.bankAccountNo,
      'Ngân hàng thụ hưởng': line.bankName,
      'Số tiền': Number(line.amountVnd),
      'Diễn giải': `Thanh toán hồ sơ ${drawdown.drawdownNo}`,
    }))

    return successResponse({ data: vpbankData, filename: `VPBank_Export_${drawdown.drawdownNo}.xlsx` })
  } catch (err) {
    console.error('Export Drawdown error:', err)
    return errorResponse('Lỗi máy chủ nội bộ', 500)
  }
}
