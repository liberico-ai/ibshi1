import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/subcontracts — list subcontractor contracts
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')
    const status = searchParams.get('status')

    const where: Record<string, unknown> = {}
    if (projectId) where.projectId = projectId
    if (status) where.status = status

    const contracts = await prisma.subcontractorContract.findMany({
      where,
      include: {
        project: { select: { projectCode: true, projectName: true } },
        vendor: { select: { vendorCode: true, name: true, category: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    const totalValue = contracts.reduce((s, c) => s + Number(c.contractValue), 0)

    return successResponse({
      contracts,
      total: contracts.length,
      totalValue,
    })
  } catch (err) {
    console.error('GET /api/subcontracts error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/subcontracts — create subcontractor contract
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const body = await req.json()
    const { projectId, contractCode, vendorId, description, contractValue, currency, startDate, endDate } = body

    if (!projectId || !contractCode || !vendorId || !description || !contractValue) {
      return errorResponse('Thiếu thông tin bắt buộc')
    }

    const exists = await prisma.subcontractorContract.findUnique({ where: { contractCode } })
    if (exists) return errorResponse(`Mã HĐ ${contractCode} đã tồn tại`)

    const contract = await prisma.subcontractorContract.create({
      data: {
        projectId,
        contractCode,
        vendorId,
        description,
        contractValue: Number(contractValue),
        currency: currency || 'VND',
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
      },
    })

    return successResponse({ contract }, 'Tạo hợp đồng thầu phụ thành công')
  } catch (err) {
    console.error('POST /api/subcontracts error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
