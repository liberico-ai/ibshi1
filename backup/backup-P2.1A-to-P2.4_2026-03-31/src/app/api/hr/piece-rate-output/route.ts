import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/hr/piece-rate-output
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const month = Number(searchParams.get('month')) || new Date().getMonth() + 1
    const year = Number(searchParams.get('year')) || new Date().getFullYear()
    const teamCode = searchParams.get('teamCode')

    const where: Record<string, unknown> = { month, year }

    const outputs = await prisma.monthlyPieceRateOutput.findMany({
      where,
      include: {
        contract: {
          select: { contractCode: true, teamCode: true, workType: true, unit: true, project: { select: { projectCode: true } } },
        },
      },
      orderBy: { totalAmount: 'desc' },
    })

    // Filter by teamCode if specified
    const filtered = teamCode ? outputs.filter(o => o.contract.teamCode === teamCode) : outputs

    // Totals
    const totals = filtered.reduce((acc, o) => ({
      totalQuantity: acc.totalQuantity + Number(o.quantity),
      totalAmount: acc.totalAmount + Number(o.totalAmount),
      count: acc.count + 1,
    }), { totalQuantity: 0, totalAmount: 0, count: 0 })

    return successResponse({ outputs: filtered, totals, month, year })
  } catch (err) {
    console.error('GET /api/hr/piece-rate-output error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/hr/piece-rate-output — create/update monthly output
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!['R01', 'R02', 'R06', 'R06b'].includes(user.roleCode)) {
      return errorResponse('Không có quyền nhập KL khoán', 403)
    }

    const body = await req.json()
    const { contractId, month, year, quantity, notes } = body

    if (!contractId || !month || !year || quantity === undefined) {
      return errorResponse('Thiếu: contractId, month, year, quantity')
    }

    // Get unit price from contract
    const contract = await prisma.pieceRateContract.findUnique({ where: { id: contractId } })
    if (!contract) return errorResponse('HĐ khoán không tồn tại', 404)

    const unitPrice = Number(contract.unitPrice)
    const totalAmount = parseFloat(quantity) * unitPrice

    const output = await prisma.monthlyPieceRateOutput.upsert({
      where: { contractId_month_year: { contractId, month: Number(month), year: Number(year) } },
      update: { quantity: parseFloat(quantity), unitPrice, totalAmount, notes },
      create: {
        contractId,
        month: Number(month),
        year: Number(year),
        quantity: parseFloat(quantity),
        unitPrice,
        totalAmount,
        notes,
      },
    })

    return successResponse({ output }, `KL khoán T${month}/${year}: ${quantity} ${contract.unit} × ${unitPrice.toLocaleString()} = ${totalAmount.toLocaleString()}₫`)
  } catch (err) {
    console.error('POST /api/hr/piece-rate-output error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
