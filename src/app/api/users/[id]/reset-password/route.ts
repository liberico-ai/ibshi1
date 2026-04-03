import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import {
  authenticateRequest,
  hashPassword,
  successResponse,
  errorResponse,
  unauthorizedResponse,
  forbiddenResponse,
  logAudit,
  getClientIP,
} from '@/lib/auth'
import { validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'

const ADMIN_ROLES = ['R01', 'R10']

// POST /api/users/[id]/reset-password
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!ADMIN_ROLES.includes(payload.roleCode)) return forbiddenResponse('Chỉ Admin mới có quyền reset mật khẩu')

    const pResult = validateParams(await params, idParamSchema)
    if (!pResult.success) return pResult.response
    const { id } = pResult.data
    const body = await req.json()
    const { newPassword } = body

    if (!newPassword || newPassword.length < 4) {
      return errorResponse('Mật khẩu mới phải có ít nhất 4 ký tự')
    }

    const existing = await prisma.user.findUnique({ where: { id } })
    if (!existing) return errorResponse('User không tồn tại', 404)

    const passwordHash = await hashPassword(newPassword)
    await prisma.user.update({ where: { id }, data: { passwordHash } })

    await logAudit(payload.userId, 'RESET_PASSWORD', 'User', id, {
      targetUser: existing.username,
    }, getClientIP(req))

    return successResponse({}, `Đã reset mật khẩu cho ${existing.username}`)
  } catch (err) {
    console.error('POST /api/users/[id]/reset-password error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
