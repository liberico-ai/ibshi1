import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/hr/contracts — list employee contracts
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type')
    const status = searchParams.get('status')

    const where: Record<string, unknown> = {}
    if (type) where.type = type
    if (status) where.status = status

    const contracts = await prisma.employeeContract.findMany({
      where,
      include: { employee: { select: { employeeCode: true, fullName: true } } },
      orderBy: { createdAt: 'desc' },
    })

    return successResponse({ contracts, total: contracts.length })
  } catch (err) {
    console.error('GET /api/hr/contracts error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
