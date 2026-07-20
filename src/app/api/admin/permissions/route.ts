import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { ROLES } from '@/lib/constants'
import { can } from '@/lib/permissions/can'
import { capabilitiesByModule } from '@/lib/permissions/catalog'
import { getRoleGrants, isRoleConfigured, getStepLevels, getAllOverrides, getDesignations } from '@/lib/permissions/store'

// GET /api/admin/permissions — danh mục + ma trận vai trò + cấu hình level/override.
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!(await can(user, 'admin.manage_permissions'))) {
    return errorResponse('Chỉ Quản trị hệ thống được xem trang phân quyền', 403)
  }

  const roleCodes = Object.keys(ROLES)
  const grants: Record<string, string[]> = {}
  const configured: Record<string, boolean> = {}
  for (const code of roleCodes) {
    grants[code] = [...(await getRoleGrants(code))].sort()
    configured[code] = await isRoleConfigured(code)
  }

  const [levels, overrides, designations] = await Promise.all([getStepLevels(), getAllOverrides(), getDesignations()])

  return successResponse({
    modules: capabilitiesByModule(),
    roles: Object.values(ROLES).map((r) => ({ code: r.code, name: r.name })),
    grants,
    configured,
    levels,
    overrides,
    designations,
  })
}
