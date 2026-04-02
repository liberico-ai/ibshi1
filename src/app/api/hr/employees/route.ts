import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { validateQuery, validateBody } from '@/lib/api-helpers'
import { employeeListQuerySchema, createEmployeeSchema } from '@/lib/schemas'

// GET /api/hr/employees — list with filters
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const qResult = validateQuery(req.url, employeeListQuerySchema)
    if (!qResult.success) return qResult.response
    const { page, search, status, department } = qResult.data
    const limit = 20

    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (department) where.departmentId = department
    if (search) where.OR = [
      { fullName: { contains: search, mode: 'insensitive' } },
      { employeeCode: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } },
    ]

    const [employees, total] = await Promise.all([
      prisma.employee.findMany({
        where: where as never,
        include: { department: true, contracts: { where: { status: 'ACTIVE' }, take: 1 } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.employee.count({ where: where as never }),
    ])

    return successResponse({
      employees: employees.map(e => ({
        ...e,
        currentSalary: e.contracts[0]?.baseSalary || null,
        departmentName: e.department?.name || null,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('GET /api/hr/employees error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/hr/employees — create employee
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!['R01', 'R02'].includes(user.roleCode)) {
      return NextResponse.json({ ok: false, error: 'Không có quyền' }, { status: 403 })
    }

    const result = await validateBody(req, createEmployeeSchema)
    if (!result.success) return result.response
    const { employeeCode, fullName, phone, email, departmentId, position, employmentType, joinDate } = result.data

    const employee = await prisma.employee.create({
      data: {
        employeeCode,
        fullName,
        phone: phone || null,
        email: email || null,
        departmentId: departmentId || null,
        position: position || null,
        employmentType: employmentType || 'FULL_TIME',
        joinDate: joinDate ? new Date(joinDate) : new Date(),
      },
    })

    return successResponse({ employee, ok: true }, 'Tạo nhân viên thành công', 201)
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
      return errorResponse('Mã nhân viên đã tồn tại', 409)
    }
    console.error('POST /api/hr/employees error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
