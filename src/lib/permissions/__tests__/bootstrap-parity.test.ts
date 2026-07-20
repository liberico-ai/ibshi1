import { describe, it, expect } from 'vitest'
import { ROLES, MENU_ITEMS, FORM_EDIT_ROLES, canEditForm } from '../../constants'
import { RBAC } from '../../rbac-rules'
import { CAPABILITIES, ACTION_TO_RBAC, PAGE_TO_MENU_KEY } from '../catalog'
import { roleCapabilitiesFromStatic } from '../bootstrap'

// Lưới an toàn của "bootstrap giống hệt": với MỌI vai trò × MỌI khả năng,
// grant tĩnh phải khớp 100% luật cũ (MENU_ITEMS.roles / FORM_EDIT_ROLES / RBAC.*).

const MENU_ROLES: Record<string, readonly string[] | 'all'> = Object.fromEntries(
  MENU_ITEMS.map((m) => [m.key, m.roles as readonly string[] | 'all']),
)

function expectedByOldRule(roleCode: string, capKey: string): boolean {
  if (capKey.startsWith('page.')) {
    const roles = MENU_ROLES[PAGE_TO_MENU_KEY[capKey]]
    return roles === 'all' || (Array.isArray(roles) && roles.includes(roleCode))
  }
  if (capKey.startsWith('form.')) {
    return canEditForm(capKey.slice('form.'.length) as keyof typeof FORM_EDIT_ROLES, roleCode)
  }
  // action.*
  if (capKey === 'admin.manage_permissions') return roleCode === 'R10'
  const group = ACTION_TO_RBAC[capKey]
  const allowed = group ? (RBAC as Record<string, readonly string[]>)[group] : undefined
  return !!allowed && allowed.includes(roleCode)
}

describe('bootstrap parity — grant tĩnh == luật cũ', () => {
  const roleCodes = Object.keys(ROLES)

  it('mọi (vai trò × khả năng) khớp luật cũ', () => {
    const mismatches: string[] = []
    for (const roleCode of roleCodes) {
      const got = roleCapabilitiesFromStatic(roleCode)
      for (const cap of CAPABILITIES) {
        const expected = expectedByOldRule(roleCode, cap.key)
        if (got.has(cap.key) !== expected) {
          mismatches.push(`${roleCode} × ${cap.key}: got ${got.has(cap.key)} ≠ expected ${expected}`)
        }
      }
    }
    expect(mismatches).toEqual([])
  })

  it('R10 luôn có admin.manage_permissions, vai trò khác thì không', () => {
    for (const roleCode of roleCodes) {
      const has = roleCapabilitiesFromStatic(roleCode).has('admin.manage_permissions')
      expect(has).toBe(roleCode === 'R10')
    }
  })

  it('trang roles:"all" (vd dashboard) cấp cho mọi vai trò', () => {
    for (const roleCode of roleCodes) {
      expect(roleCapabilitiesFromStatic(roleCode).has('page.dashboard')).toBe(true)
    }
  })
})
