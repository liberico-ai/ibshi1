import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'

const ALLOWED_ROLES = ['R01', 'R02', 'R02a', 'R08', 'R08a']

// GET /api/employees — list employees
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, ALLOWED_ROLES)) return errorResponse('Forbidden', 403)

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const departmentId = searchParams.get('departmentId')

    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (departmentId) where.departmentId = departmentId

    const employees = await prisma.employee.findMany({
      where,
      include: { department: { select: { name: true } } },
      orderBy: { employeeCode: 'asc' },
    })

    return successResponse({ employees, total: employees.length })
  } catch (err) {
    console.error('GET /api/employees error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
