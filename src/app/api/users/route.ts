import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, hashPassword, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createUserSchema } from '@/lib/schemas'

// GET /api/users — List all users
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        fullName: true,
        roleCode: true,
        userLevel: true,
        email: true,
        isActive: true,
        department: { select: { code: true, name: true } },
        createdAt: true,
      },
      orderBy: { roleCode: 'asc' },
    })

    return successResponse({ users })
  } catch (err) {
    console.error('GET /api/users error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/users — Create a new user (R01 only)
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    if (!['R01', 'R10'].includes(payload.roleCode)) {
      return errorResponse('Chỉ BGĐ hoặc Admin hệ thống mới có quyền tạo người dùng', 403)
    }

    const result = await validateBody(req, createUserSchema)
    if (!result.success) return result.response
    const { username, password, fullName, roleCode, userLevel, email, departmentCode } = result.data

    const existing = await prisma.user.findUnique({ where: { username } })
    if (existing) return errorResponse(`Username ${username} đã tồn tại`)

    let departmentId: string | undefined
    if (departmentCode) {
      const dept = await prisma.department.findUnique({ where: { code: departmentCode } })
      if (dept) departmentId = dept.id
    }

    const passwordHash = await hashPassword(password)

    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        fullName,
        roleCode,
        userLevel: userLevel || 2,
        email,
        departmentId,
      },
    })

    return successResponse({
      user: { id: user.id, username: user.username, fullName: user.fullName, roleCode: user.roleCode },
    }, 'Tạo người dùng thành công', 201)
  } catch (err) {
    console.error('POST /api/users error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
