import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import {
  authenticateRequest,
  verifyPassword,
  hashPassword,
  successResponse,
  errorResponse,
  unauthorizedResponse,
  logAudit,
  getClientIP,
} from '@/lib/auth'

const MIN_LEN = 6

// POST /api/auth/change-password — người dùng tự đổi mật khẩu (xác minh mật khẩu hiện tại)
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const body = await req.json().catch(() => ({}))
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''

    if (!currentPassword || !newPassword) {
      return errorResponse('Thiếu mật khẩu hiện tại hoặc mật khẩu mới', 400)
    }
    if (newPassword.length < MIN_LEN) {
      return errorResponse(`Mật khẩu mới phải có ít nhất ${MIN_LEN} ký tự`, 400)
    }
    if (newPassword === currentPassword) {
      return errorResponse('Mật khẩu mới phải khác mật khẩu hiện tại', 400)
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, username: true, passwordHash: true },
    })
    if (!user) return unauthorizedResponse()

    const ok = await verifyPassword(currentPassword, user.passwordHash)
    if (!ok) return errorResponse('Mật khẩu hiện tại không đúng', 400)

    const passwordHash = await hashPassword(newPassword)
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } })

    await logAudit(user.id, 'CHANGE_PASSWORD', 'User', user.id, { username: user.username }, getClientIP(req))

    return successResponse({}, 'Đổi mật khẩu thành công')
  } catch (err) {
    console.error('POST /api/auth/change-password error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
