import { describe, it, expect } from 'vitest'
import { PAGE_ACCESS, MENU_ITEMS } from '../constants'
import { requireRoles } from '../auth'

function isBlocked(pathname: string, roleCode: string): boolean {
  const checks = Object.entries(PAGE_ACCESS)
    .filter(([h]) => h !== '/dashboard')
    .sort((a, b) => b[0].length - a[0].length)
  for (const [href, roles] of checks) {
    if (pathname === href || pathname.startsWith(href + '/')) {
      if (roles === 'all') return false
      return !(roles as readonly string[]).includes(roleCode)
    }
  }
  return false
}

describe('PAGE_ACCESS route guard', () => {
  it('PAGE_ACCESS has entries for all MENU_ITEMS', () => {
    for (const item of MENU_ITEMS) {
      expect(PAGE_ACCESS[item.href]).toBeDefined()
      expect(PAGE_ACCESS[item.href]).toBe(item.roles)
    }
  })

  it('R06b blocked from finance pages', () => {
    expect(isBlocked('/dashboard/finance', 'R06b')).toBe(true)
    expect(isBlocked('/dashboard/finance/payments', 'R06b')).toBe(true)
    expect(isBlocked('/dashboard/finance/cashflow', 'R06b')).toBe(true)
  })

  it('R08 can access finance pages', () => {
    expect(isBlocked('/dashboard/finance', 'R08')).toBe(false)
    expect(isBlocked('/dashboard/finance/payments', 'R08')).toBe(false)
  })

  it('R07 blocked from QC pages', () => {
    expect(isBlocked('/dashboard/qc', 'R07')).toBe(true)
    expect(isBlocked('/dashboard/qc/inspections', 'R07')).toBe(true)
    expect(isBlocked('/dashboard/qc/ncr', 'R07')).toBe(true)
  })

  it('R09 can access QC pages', () => {
    expect(isBlocked('/dashboard/qc', 'R09')).toBe(false)
    expect(isBlocked('/dashboard/qc/inspections', 'R09')).toBe(false)
  })

  it('R06 blocked from admin/users pages', () => {
    expect(isBlocked('/dashboard/users', 'R06')).toBe(true)
    expect(isBlocked('/dashboard/admin', 'R06')).toBe(true)
  })

  it('R01 can access all pages', () => {
    const restricted = MENU_ITEMS.filter(m => m.roles !== 'all')
    for (const item of restricted) {
      expect(isBlocked(item.href, 'R01')).toBe(false)
    }
  })

  it('roles=all pages are accessible to any role', () => {
    expect(isBlocked('/dashboard/work', 'R06b')).toBe(false)
    expect(isBlocked('/dashboard/settings', 'R06b')).toBe(false)
    expect(isBlocked('/dashboard/notifications', 'R06b')).toBe(false)
  })

  it('/dashboard itself is always allowed', () => {
    expect(isBlocked('/dashboard', 'R06b')).toBe(false)
  })

  it('most specific href match wins', () => {
    expect(isBlocked('/dashboard/qc/ncr', 'R06')).toBe(false)
    expect(isBlocked('/dashboard/qc/inspections', 'R06')).toBe(true)
  })

  it('R07 blocked from warehouse/movements but can access warehouse/purchase-orders', () => {
    expect(isBlocked('/dashboard/warehouse/movements', 'R07')).toBe(true)
    expect(isBlocked('/dashboard/warehouse/purchase-orders', 'R07')).toBe(false)
  })
})

describe('API-level RBAC (requireRoles guard)', () => {
  const API_ROLE_MAP: Record<string, string[]> = {
    '/api/drawings': ['R01', 'R04', 'R04a', 'R02', 'R02a'],
    '/api/warehouse/stats': ['R01', 'R03', 'R03a', 'R05', 'R05a'],
    '/api/purchase-orders': ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R05', 'R05a', 'R07', 'R07a'],
    '/api/materials/quick-create': ['R01', 'R03', 'R03a', 'R05', 'R05a', 'R10'],
    '/api/workshops': ['R01', 'R06', 'R06a'],
    '/api/qc/mrb': ['R01', 'R09', 'R09a'],
    '/api/mill-certificates': ['R01', 'R09', 'R09a'],
    '/api/finance/budgets/variance': ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R08', 'R08a'],
    '/api/finance/payments/drawdown/export': ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R08', 'R08a'],
    '/api/finance/payments/drawdown/sync-misa': ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R08', 'R08a'],
    '/api/employees': ['R01', 'R02', 'R02a'],
    '/api/departments': ['R01', 'R02', 'R02a'],
    '/api/procurement-tracking': ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R05', 'R05a', 'R07', 'R07a'],
    '/api/milestones': ['R01', 'R02', 'R02a', 'R03', 'R03a'],
    '/api/subcontracts': ['R01', 'R02', 'R02a', 'R07', 'R07a'],
    '/api/lessons': ['R01', 'R02', 'R02a'],
    '/api/safety': ['R01', 'R02', 'R02a', 'R06', 'R06a', 'R09', 'R09a'],
    '/api/reports': ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R06', 'R06a', 'R08', 'R08a', 'R09', 'R09a', 'R13'],
    '/api/reports/executive': ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R06', 'R06a', 'R08', 'R08a', 'R09', 'R09a', 'R13'],
    '/api/reports/project-profitability': ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R06', 'R06a', 'R08', 'R08a', 'R09', 'R09a', 'R13'],
  }

  it('R06b (worker) is blocked from ALL restricted APIs', () => {
    for (const [api, roles] of Object.entries(API_ROLE_MAP)) {
      expect(requireRoles('R06b', roles)).toBe(false)
    }
  })

  it('R01 (BGĐ) can access ALL APIs', () => {
    for (const [, roles] of Object.entries(API_ROLE_MAP)) {
      expect(requireRoles('R01', roles)).toBe(true)
    }
  })

  it('R09 can access QC APIs but not finance/HR', () => {
    expect(requireRoles('R09', API_ROLE_MAP['/api/qc/mrb'])).toBe(true)
    expect(requireRoles('R09', API_ROLE_MAP['/api/mill-certificates'])).toBe(true)
    expect(requireRoles('R09', API_ROLE_MAP['/api/finance/budgets/variance'])).toBe(false)
    expect(requireRoles('R09', API_ROLE_MAP['/api/employees'])).toBe(false)
  })

  it('R07 can access procurement but not QC/production', () => {
    expect(requireRoles('R07', API_ROLE_MAP['/api/procurement-tracking'])).toBe(true)
    expect(requireRoles('R07', API_ROLE_MAP['/api/purchase-orders'])).toBe(true)
    expect(requireRoles('R07', API_ROLE_MAP['/api/qc/mrb'])).toBe(false)
    expect(requireRoles('R07', API_ROLE_MAP['/api/workshops'])).toBe(false)
  })

  it('R08 can access finance but not production/design', () => {
    expect(requireRoles('R08', API_ROLE_MAP['/api/finance/budgets/variance'])).toBe(true)
    expect(requireRoles('R08', API_ROLE_MAP['/api/drawings'])).toBe(false)
    expect(requireRoles('R08', API_ROLE_MAP['/api/workshops'])).toBe(false)
  })
})
