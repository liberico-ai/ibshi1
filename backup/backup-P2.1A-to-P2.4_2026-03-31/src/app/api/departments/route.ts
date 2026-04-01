import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/departments — list departments with employee counts
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const depts = await prisma.department.findMany({
      include: {
        _count: { select: { employees: true, users: true } },
      },
      orderBy: { code: 'asc' },
    })

    return successResponse({ departments: depts, total: depts.length })
  } catch (err) {
    console.error('GET /api/departments error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/departments — create department
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const body = await req.json()
    const { code, name, nameEn } = body

    if (!code || !name) return errorResponse('Thiếu: code, name')

    const exists = await prisma.department.findUnique({ where: { code } })
    if (exists) return errorResponse(`Mã phòng ban ${code} đã tồn tại`)

    const dept = await prisma.department.create({
      data: { code, name, nameEn: nameEn || '' },
    })

    return successResponse({ department: dept }, 'Tạo phòng ban thành công')
  } catch (err) {
    console.error('POST /api/departments error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
