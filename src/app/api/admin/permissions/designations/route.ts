import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { can } from '@/lib/permissions/can'
import { getDesignations, setDesignations, type Designations } from '@/lib/permissions/store'

// PUT /api/admin/permissions/designations — đặt lại toàn bộ chỉ định cá nhân theo bước.
// Body: { designations: { "<projectId>:<stepCode>": "<userId>" } }
export async function PUT(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!(await can(user, 'admin.manage_permissions'))) {
    return errorResponse('Không có quyền chỉnh phân quyền', 403)
  }

  const body = await req.json().catch(() => null)
  const input = (body?.designations || {}) as Record<string, string>
  if (typeof input !== 'object') return errorResponse('designations không hợp lệ', 400)

  // Chuẩn hoá + kiểm khoá dạng "<projectId>:<stepCode>" và user tồn tại/active.
  const clean: Designations = {}
  const userIds = [...new Set(Object.values(input).filter(Boolean))]
  const valid = userIds.length
    ? new Set((await prisma.user.findMany({ where: { id: { in: userIds }, isActive: true }, select: { id: true } })).map((u) => u.id))
    : new Set<string>()
  for (const [key, uid] of Object.entries(input)) {
    if (!uid) continue
    if (!/^[^:]+:[^:]+/.test(key)) return errorResponse(`Khoá không hợp lệ: ${key} (cần dạng projectId:stepCode)`, 400)
    if (!valid.has(uid)) return errorResponse(`Người dùng không hợp lệ/đã nghỉ: ${uid}`, 400)
    clean[key] = uid
  }

  const before = await getDesignations()
  await setDesignations(clean)

  await logAudit(user.userId, 'UPDATE', 'PermissionMatrix', 'designations',
    { before, after: clean }, getClientIP(req))

  return successResponse({ designations: clean }, 'Đã lưu chỉ định cá nhân theo bước')
}
