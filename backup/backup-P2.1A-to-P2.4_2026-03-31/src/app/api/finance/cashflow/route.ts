import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/finance/cashflow — monthly cashflow summary
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const month = Number(searchParams.get('month')) || new Date().getMonth() + 1
    const year = Number(searchParams.get('year')) || new Date().getFullYear()

    const startDate = new Date(year, month - 1, 1)
    const endDate = new Date(year, month, 0, 23, 59, 59)

    const entries = await prisma.cashflowEntry.findMany({
      where: { entryDate: { gte: startDate, lte: endDate } },
      include: { project: { select: { projectCode: true, projectName: true } } },
      orderBy: { entryDate: 'desc' },
    })

    const totalInflow = entries.filter(e => e.type === 'INFLOW').reduce((s, e) => s + Number(e.amount), 0)
    const totalOutflow = entries.filter(e => e.type === 'OUTFLOW').reduce((s, e) => s + Number(e.amount), 0)

    // By category
    const byCategory: Record<string, { inflow: number; outflow: number }> = {}
    for (const e of entries) {
      if (!byCategory[e.category]) byCategory[e.category] = { inflow: 0, outflow: 0 }
      if (e.type === 'INFLOW') byCategory[e.category].inflow += Number(e.amount)
      else byCategory[e.category].outflow += Number(e.amount)
    }

    return successResponse({
      entries, totals: { inflow: totalInflow, outflow: totalOutflow, net: totalInflow - totalOutflow },
      byCategory, month, year,
    })
  } catch (err) {
    console.error('GET /api/finance/cashflow error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/finance/cashflow — create entry
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const body = await req.json()
    const { entryCode, projectId, type, category, amount, description, entryDate, reference } = body

    if (!entryCode || !type || !category || !amount || !entryDate) return errorResponse('Thiếu thông tin', 400)

    const entry = await prisma.cashflowEntry.create({
      data: {
        entryCode, projectId: projectId || null,
        type, category, amount: Number(amount),
        description: description || null,
        entryDate: new Date(entryDate),
        reference: reference || null,
      },
    })

    return successResponse({ entry, ok: true }, 'Tạo thành công', 201)
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
      return errorResponse('Mã dòng tiền đã tồn tại', 409)
    }
    console.error('POST /api/finance/cashflow error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
