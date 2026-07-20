import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { can } from '@/lib/permissions/can'
import { getStepLevels, setStepLevels, type StepLevels } from '@/lib/permissions/store'

// PUT /api/admin/permissions/levels — lưu quy tắc cấp bậc theo bước.
// Body: { levels: { [stepCode]: { minLevel?: 1|2, requiresApproval?: bool, approverLevel?: 1|2 } } }
export async function PUT(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!(await can(user, 'admin.manage_permissions'))) {
    return errorResponse('Không có quyền chỉnh phân quyền', 403)
  }

  const body = await req.json().catch(() => null)
  const levels = body?.levels as StepLevels
  if (!levels || typeof levels !== 'object') return errorResponse('levels không hợp lệ', 400)

  // Chuẩn hoá: bỏ rule rỗng, chỉ giữ minLevel ∈ {1,2}
  const clean: StepLevels = {}
  for (const [step, rule] of Object.entries(levels)) {
    const r = rule || {}
    const out: { minLevel?: 1 | 2; requiresApproval?: boolean; approverLevel?: 1 | 2 } = {}
    if (r.minLevel === 1 || r.minLevel === 2) out.minLevel = r.minLevel
    if (r.requiresApproval) out.requiresApproval = true
    if (r.approverLevel === 1 || r.approverLevel === 2) out.approverLevel = r.approverLevel
    if (Object.keys(out).length) clean[step] = out
  }

  const before = await getStepLevels()
  await setStepLevels(clean)

  await logAudit(user.userId, 'UPDATE', 'PermissionMatrix', 'levels',
    { before, after: clean }, getClientIP(req))

  return successResponse({ levels: clean }, 'Đã lưu quy tắc cấp bậc theo bước')
}
