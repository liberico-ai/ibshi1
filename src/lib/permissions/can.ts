// ── Cổng kiểm quyền tập trung ──
// Mọi điểm kiểm quyền (dần dần) gọi về đây. Thứ tự phân giải:
//   0. Sàn an toàn: R10 luôn có 'admin.manage_permissions' (không tự khoá chết)
//   1. User bị DENY riêng   → cấm
//   2. User được ALLOW riêng → cho
//   3. Bước yêu cầu cấp bậc cao hơn user → cấm (trục Level)
//   4. Vai trò có khả năng  → cho
//   5. Còn lại → cấm

// Server-only (qua store→prisma). Client dùng /api/me/capabilities, không import file này.
import { getRoleGrants, getUserOverrides, getStepLevels, type Effect } from './store'

export interface AuthLike { userId: string; roleCode: string; userLevel: number }
export interface CanCtx { projectId?: string; stepCode?: string }

const ADMIN_FLOOR_CAP = 'admin.manage_permissions'

/** Lõi quyết định — THUẦN, không I/O, để test dễ. */
export function evaluate(opts: {
  adminFloor?: boolean
  override?: Effect
  levelBlocked?: boolean
  roleHas: boolean
}): boolean {
  if (opts.adminFloor) return true
  if (opts.override === 'DENY') return false
  if (opts.override === 'ALLOW') return true
  if (opts.levelBlocked) return false
  return opts.roleHas
}

/** Cấp bậc của bước có chặn user này không (chỉ áp khi có stepCode + rule). */
async function isLevelBlocked(user: AuthLike, ctx?: CanCtx): Promise<boolean> {
  if (!ctx?.stepCode) return false
  const rule = (await getStepLevels())[ctx.stepCode]
  if (!rule?.minLevel) return false
  // userLevel nhỏ hơn = cấp cao hơn (L1=1 > L2=2). minLevel=1 nghĩa "phải L1 trở lên".
  return user.userLevel > rule.minLevel
}

/** Câu hỏi trung tâm: user này có được làm 'cap' không (trong ngữ cảnh ctx)? */
export async function can(user: AuthLike, cap: string, ctx?: CanCtx): Promise<boolean> {
  const adminFloor = cap === ADMIN_FLOOR_CAP && user.roleCode === 'R10'
  if (adminFloor) return true

  const overrides = await getUserOverrides(user.userId)
  const override = overrides[cap]
  if (override === 'DENY') return false
  if (override === 'ALLOW') return true

  if (await isLevelBlocked(user, ctx)) return false

  const roleCaps = await getRoleGrants(user.roleCode)
  return roleCaps.has(cap)
}

/**
 * Tập khả năng hiệu lực của user — cho frontend ẩn/hiện menu & nút.
 * (Không áp trục Level vì phần này không gắn ngữ cảnh bước cụ thể.)
 */
export async function getEffectiveCapabilities(user: AuthLike): Promise<string[]> {
  const roleCaps = await getRoleGrants(user.roleCode)
  const overrides = await getUserOverrides(user.userId)
  const set = new Set(roleCaps)
  for (const [cap, eff] of Object.entries(overrides)) {
    if (eff === 'ALLOW') set.add(cap)
    else if (eff === 'DENY') set.delete(cap)
  }
  if (user.roleCode === 'R10') set.add(ADMIN_FLOOR_CAP)
  return [...set].sort()
}
