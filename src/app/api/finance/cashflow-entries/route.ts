import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/finance/cashflow-entries — list cashflow entries with summary
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')
    const type = searchParams.get('type')
    const month = searchParams.get('month')
    const year = searchParams.get('year')

    const where: Record<string, unknown> = {}
    if (projectId) where.projectId = projectId
    if (type) where.type = type
    if (month && year) {
      const start = new Date(Number(year), Number(month) - 1, 1)
      const end = new Date(Number(year), Number(month), 0, 23, 59, 59)
      where.entryDate = { gte: start, lte: end }
    }

    const entries = await prisma.cashflowEntry.findMany({
      where,
      include: { project: { select: { projectCode: true, projectName: true } } },
      orderBy: { entryDate: 'desc' },
    })

    const inflow = entries.filter(e => e.type === 'INFLOW').reduce((s, e) => s + Number(e.amount), 0)
    const outflow = entries.filter(e => e.type === 'OUTFLOW').reduce((s, e) => s + Number(e.amount), 0)

    return successResponse({
      entries,
      total: entries.length,
      summary: { inflow, outflow, net: inflow - outflow },
    })
  } catch (err) {
    console.error('GET /api/finance/cashflow-entries error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/finance/cashflow-entries — create cashflow entry
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const body = await req.json()
    const { entryCode, projectId, type, category, amount, description, entryDate, reference } = body

    if (!entryCode || !type || !category || !amount || !entryDate) {
      return errorResponse('Thiếu: entryCode, type, category, amount, entryDate')
    }

    const exists = await prisma.cashflowEntry.findUnique({ where: { entryCode } })
    if (exists) return errorResponse(`Mã ${entryCode} đã tồn tại`)

    const entry = await prisma.cashflowEntry.create({
      data: {
        entryCode, type, category,
        amount: Number(amount),
        description: description || null,
        entryDate: new Date(entryDate),
        reference: reference || null,
        projectId: projectId || null,
      },
    })

    return successResponse({ entry }, 'Ghi nhận dòng tiền thành công')
  } catch (err) {
    console.error('POST /api/finance/cashflow-entries error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
