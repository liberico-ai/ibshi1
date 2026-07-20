// ── Bootstrap: dịch luật phân quyền TĨNH hiện tại → tập capability ──
// Đây là "nguồn sự thật giống hệt": can() khi role CHƯA được cấu hình trong DB
// sẽ rơi về đây, nên ngày đầu hành vi trùng 100% code cũ. Test parity khoá chặt.

import { ROLES, MENU_ITEMS, FORM_EDIT_ROLES } from '../constants'
import { RBAC } from '../rbac-rules'
import {
  ACTION_CAPABILITIES, FORM_CAPABILITIES, PAGE_CAPABILITIES,
  ACTION_TO_RBAC, PAGE_TO_MENU_KEY,
} from './catalog'

type RoleArray = readonly string[]

// menu key → roles (giữ nguyên 'all')
const MENU_ROLES: Record<string, RoleArray | 'all'> = Object.fromEntries(
  MENU_ITEMS.map((m) => [m.key, m.roles as RoleArray | 'all']),
)

/** Tập capability của một role theo LUẬT TĨNH hiện tại. */
export function roleCapabilitiesFromStatic(roleCode: string): Set<string> {
  const out = new Set<string>()

  // Action (RBAC.*)
  for (const cap of ACTION_CAPABILITIES) {
    if (cap.key === 'admin.manage_permissions') {
      if (roleCode === 'R10') out.add(cap.key)
      continue
    }
    const group = ACTION_TO_RBAC[cap.key]
    const allowed = group ? (RBAC as Record<string, RoleArray>)[group] : undefined
    if (allowed && allowed.includes(roleCode)) out.add(cap.key)
  }

  // Form (FORM_EDIT_ROLES)
  for (const cap of FORM_CAPABILITIES) {
    const formKey = cap.key.slice('form.'.length)
    const allowed = (FORM_EDIT_ROLES as Record<string, RoleArray>)[formKey]
    if (allowed && allowed.includes(roleCode)) out.add(cap.key)
  }

  // Page (MENU_ITEMS.roles)
  for (const cap of PAGE_CAPABILITIES) {
    const menuKey = PAGE_TO_MENU_KEY[cap.key]
    const roles = MENU_ROLES[menuKey]
    if (roles === 'all' || (Array.isArray(roles) && roles.includes(roleCode))) out.add(cap.key)
  }

  return out
}

/** Grant tĩnh cho TẤT CẢ 22 role — dùng để seed UI admin và script bootstrap DB. */
export function allRolesStaticGrants(): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const roleCode of Object.keys(ROLES)) {
    out[roleCode] = [...roleCapabilitiesFromStatic(roleCode)].sort()
  }
  return out
}
