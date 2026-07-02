import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createPieceRateOutputSchema } from '@/lib/schemas'
import { recalcBudgetActual } from '@/lib/sync-engine'

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

    const result = await validateBody(req, createPieceRateOutputSchema)
    if (!result.success) return result.response
    const { contractId, month, year, quantity, notes } = result.data

    // Get unit price from contract
    const contract = await prisma.pieceRateContract.findUnique({ where: { id: contractId } })
    if (!contract) return errorResponse('HĐ khoán không tồn tại', 404)

    const unitPrice = Number(contract.unitPrice)
    const totalAmount = quantity * unitPrice

    const output = await prisma.monthlyPieceRateOutput.upsert({
      where: { contractId_month_year: { contractId, month, year } },
      update: { quantity, unitPrice, totalAmount, notes },
      create: {
        contractId,
        month,
        year,
        quantity,
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

// PATCH /api/hr/piece-rate-output — nghiệm thu KL khoán (DRAFT → VERIFIED)
// Nghiệm thu = chốt chi phí LABOR thực tế của dự án → recalcBudgetActual.
export async function PATCH(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!['R01', 'R02', 'R08', 'R10'].includes(user.roleCode)) {
      return errorResponse('Không có quyền nghiệm thu KL khoán', 403)
    }

    const body = await req.json().catch(() => null)
    const outputId = body?.outputId
    if (!outputId || typeof outputId !== 'string') return errorResponse('Thiếu outputId', 400)

    const output = await prisma.monthlyPieceRateOutput.findUnique({
      where: { id: outputId },
      include: { contract: { select: { projectId: true } } },
    })
    if (!output) return errorResponse('KL khoán không tồn tại', 404)

    // Idempotent: đã VERIFIED thì trả về luôn, không ghi lại
    if (output.status === 'VERIFIED') {
      return successResponse({ output }, 'KL khoán đã được nghiệm thu trước đó')
    }

    const updated = await prisma.monthlyPieceRateOutput.update({
      where: { id: outputId },
      data: { status: 'VERIFIED', verifiedBy: user.userId },
    })

    // Nguồn duy nhất tính actual: recalcBudgetActual (LABOR = Σ output VERIFIED)
    try { await recalcBudgetActual(output.contract.projectId, user.userId) }
    catch (e) { console.error('[piece-rate-output] recalcBudgetActual error:', e) }

    return successResponse({ output: updated }, 'Đã nghiệm thu KL khoán')
  } catch (err) {
    console.error('PATCH /api/hr/piece-rate-output error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
