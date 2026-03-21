import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'

// GET /api/hr/piece-rate-contracts
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')
    const teamCode = searchParams.get('teamCode')
    const status = searchParams.get('status')

    const where: Record<string, unknown> = {}
    if (projectId) where.projectId = projectId
    if (teamCode) where.teamCode = teamCode
    if (status) where.status = status

    const contracts = await prisma.pieceRateContract.findMany({
      where,
      include: {
        project: { select: { projectCode: true, projectName: true } },
        outputs: { orderBy: { year: 'desc' }, take: 3 },
      },
      orderBy: { createdAt: 'desc' },
    })

    return successResponse({ contracts })
  } catch (err) {
    console.error('GET /api/hr/piece-rate-contracts error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/hr/piece-rate-contracts
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!['R01', 'R02', 'R06'].includes(user.roleCode)) {
      return errorResponse('Không có quyền tạo hợp đồng khoán', 403)
    }

    const body = await req.json()
    const { projectId, teamCode, workType, unitPrice, unit, contractValue, startDate, endDate } = body

    if (!projectId || !teamCode || !workType || !unitPrice) {
      return errorResponse('Thiếu thông tin: projectId, teamCode, workType, unitPrice')
    }

    const count = await prisma.pieceRateContract.count()
    const contractCode = `KH-${String(count + 1).padStart(4, '0')}`

    const contract = await prisma.pieceRateContract.create({
      data: {
        contractCode,
        projectId,
        teamCode,
        workType,
        unitPrice: parseFloat(unitPrice),
        unit: unit || 'kg',
        contractValue: contractValue ? parseFloat(contractValue) : null,
        startDate: new Date(startDate || Date.now()),
        endDate: endDate ? new Date(endDate) : null,
      },
    })

    await logAudit(user.userId, 'CREATE', 'PieceRateContract', contract.id, { contractCode, teamCode, workType }, getClientIP(req))

    return successResponse({ contract }, `HĐ khoán ${contractCode} đã tạo`, 201)
  } catch (err) {
    console.error('POST /api/hr/piece-rate-contracts error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
