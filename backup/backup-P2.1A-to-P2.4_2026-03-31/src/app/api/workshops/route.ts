import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/workshops — list workshops with WO counts
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const workshops = await prisma.workshop.findMany({
      include: { _count: { select: { workOrders: true } } },
      orderBy: { code: 'asc' },
    })

    return successResponse({ workshops, total: workshops.length })
  } catch (err) {
    console.error('GET /api/workshops error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/workshops — create workshop
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const body = await req.json()
    const { code, name, nameEn, capacity } = body

    if (!code || !name) return errorResponse('Thiếu: code, name')

    const exists = await prisma.workshop.findUnique({ where: { code } })
    if (exists) return errorResponse(`Mã xưởng ${code} đã tồn tại`)

    const ws = await prisma.workshop.create({
      data: { code, name, nameEn: nameEn || '', capacity: Number(capacity || 100) },
    })

    return successResponse({ workshop: ws }, 'Tạo xưởng thành công')
  } catch (err) {
    console.error('POST /api/workshops error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
