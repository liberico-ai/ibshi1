import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { ROLES } from '@/lib/constants'
import { can } from '@/lib/permissions/can'
import { isKnownCapability } from '@/lib/permissions/catalog'
import { getRoleGrants, setRoleGrants } from '@/lib/permissions/store'

// PUT /api/admin/permissions/roles — lưu grant cho MỘT vai trò. Body: { roleCode, capabilities[] }
export async function PUT(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!(await can(user, 'admin.manage_permissions'))) {
    return errorResponse('Không có quyền chỉnh phân quyền', 403)
  }

  const body = await req.json().catch(() => null)
  const roleCode = body?.roleCode as string
  const capabilities = body?.capabilities as string[]
  if (!roleCode || !(roleCode in ROLES)) return errorResponse('roleCode không hợp lệ', 400)
  if (!Array.isArray(capabilities)) return errorResponse('capabilities phải là mảng', 400)

  const unknown = capabilities.filter((c) => !isKnownCapability(c))
  if (unknown.length) return errorResponse(`Khả năng không tồn tại: ${unknown.join(', ')}`, 400)

  // Sàn an toàn: không cho gỡ quyền quản lý phân quyền khỏi R10 (chống tự khoá chết).
  if (roleCode === 'R10' && !capabilities.includes('admin.manage_permissions')) {
    capabilities.push('admin.manage_permissions')
  }

  const before = [...(await getRoleGrants(roleCode))].sort()
  await setRoleGrants(roleCode, capabilities)
  const after = [...new Set(capabilities)].sort()

  await logAudit(user.userId, 'UPDATE', 'PermissionMatrix', `role:${roleCode}`,
    { roleCode, before, after }, getClientIP(req))

  return successResponse({ roleCode, capabilities: after }, `Đã lưu quyền cho ${ROLES[roleCode as keyof typeof ROLES].name}`)
}
