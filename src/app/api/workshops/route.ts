import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createWorkshopSchema } from '@/lib/schemas'

const ALLOWED_ROLES = ['R01', 'R06', 'R06a']

// GET /api/workshops — list workshops with WO counts
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, ALLOWED_ROLES)) return errorResponse('Forbidden', 403)

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
    if (!requireRoles(user.roleCode, ALLOWED_ROLES)) return errorResponse('Forbidden', 403)

    const result = await validateBody(req, createWorkshopSchema)
    if (!result.success) return result.response
    const { code, name, nameEn, capacity } = result.data

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
