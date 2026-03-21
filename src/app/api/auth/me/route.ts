import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, unauthorizedResponse, errorResponse } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        username: true,
        fullName: true,
        roleCode: true,
        userLevel: true,
        email: true,
        isActive: true,
        department: { select: { code: true, name: true } },
      },
    })

    if (!user || !user.isActive) return unauthorizedResponse('Tài khoản không hợp lệ')

    return successResponse({ user })
  } catch {
    return errorResponse('Lỗi hệ thống', 500)
  }
}
