import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { can } from '@/lib/permissions/can'
import { isKnownCapability } from '@/lib/permissions/catalog'
import { getUserOverrides, setUserOverrides, type Effect, type OverrideMap } from '@/lib/permissions/store'

// PUT /api/admin/permissions/overrides — đặt lại override cho MỘT user.
// Body: { userId, overrides: { [capKey]: 'ALLOW' | 'DENY' } }  (rỗng = xoá hết)
export async function PUT(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!(await can(user, 'admin.manage_permissions'))) {
    return errorResponse('Không có quyền chỉnh phân quyền', 403)
  }

  const body = await req.json().catch(() => null)
  const userId = body?.userId as string
  const overrides = (body?.overrides || {}) as Record<string, string>
  if (!userId) return errorResponse('Thiếu userId', 400)

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, fullName: true } })
  if (!target) return errorResponse('Không tìm thấy người dùng', 404)

  const clean: OverrideMap = {}
  for (const [cap, eff] of Object.entries(overrides)) {
    if (!isKnownCapability(cap)) return errorResponse(`Khả năng không tồn tại: ${cap}`, 400)
    if (eff !== 'ALLOW' && eff !== 'DENY') return errorResponse(`Hiệu lực không hợp lệ: ${eff}`, 400)
    clean[cap] = eff as Effect
  }

  const before = await getUserOverrides(userId)
  await setUserOverrides(userId, clean)

  await logAudit(user.userId, 'UPDATE', 'PermissionMatrix', `user:${userId}`,
    { userId, fullName: target.fullName, before, after: clean }, getClientIP(req))

  return successResponse({ userId, overrides: clean }, `Đã lưu quyền riêng cho ${target.fullName}`)
}
