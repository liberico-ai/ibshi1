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

  it('R01 can access all pages (except các trang R10-only)', () => {
    // Trang R10-only (roles đúng bằng ['R10']) — R01 không vào, vd style-guide, permissions.
    const restricted = MENU_ITEMS.filter(m => m.roles !== 'all' && !(m.roles as readonly string[]).every(r => r === 'R10'))
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

  it('R99 (unknown role) blocked from ALL restricted pages, sees only roles=all', () => {
    const restricted = MENU_ITEMS.filter(m => m.roles !== 'all')
    for (const item of restricted) {
      expect(isBlocked(item.href, 'R99')).toBe(true)
    }
    const open = MENU_ITEMS.filter(m => m.roles === 'all')
    for (const item of open) {
      expect(isBlocked(item.href, 'R99')).toBe(false)
    }
  })

  it('R02 blocked from salary/contracts (new matrix)', () => {
    expect(isBlocked('/dashboard/hr/salary', 'R02')).toBe(true)
    expect(isBlocked('/dashboard/hr/contracts', 'R02')).toBe(true)
  })

  it('R08 can access HR pages (employees, salary, timesheets)', () => {
    expect(isBlocked('/dashboard/hr', 'R08')).toBe(false)
    expect(isBlocked('/dashboard/hr/employees', 'R08')).toBe(false)
    expect(isBlocked('/dashboard/hr/salary', 'R08')).toBe(false)
    expect(isBlocked('/dashboard/hr/timesheets', 'R08')).toBe(false)
    expect(isBlocked('/dashboard/hr/contracts', 'R08')).toBe(false)
  })

  it('R05/R07 can access reports (new matrix)', () => {
    expect(isBlocked('/dashboard/reports', 'R05')).toBe(false)
    expect(isBlocked('/dashboard/reports', 'R07')).toBe(false)
  })

  it('R09 can access ECO (new matrix)', () => {
    expect(isBlocked('/dashboard/design/eco', 'R09')).toBe(false)
  })

  it('R07 can access projects (new matrix)', () => {
    expect(isBlocked('/dashboard/projects', 'R07')).toBe(false)
  })
})

describe('API-level RBAC (requireRoles guard)', () => {
  const API_ROLE_MAP: Record<string, string[]> = {
    '/api/drawings': ['R01', 'R04', 'R04a', 'R02', 'R02a'],
    '/api/warehouse/stats': ['R01', 'R03', 'R03a', 'R05', 'R05a'],
    '/api/purchase-orders': ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R05', 'R05a', 'R07', 'R07a'],
    '/api/materials/quick-create': ['R01', 'R03', 'R03a', 'R05', 'R05a', 'R10'],
    '/api/workshops': ['R01', 'R02', 'R02a', 'R06', 'R06a'], // GET (view) — POST vẫn chỉ R01/R06/R06a
    '/api/qc/mrb': ['R01', 'R09', 'R09a'],
    '/api/mill-certificates': ['R01', 'R09', 'R09a'],
    '/api/finance/budgets/variance': ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R08', 'R08a'],
    '/api/finance/payments/drawdown/export': ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R08', 'R08a'],
    '/api/finance/payments/drawdown/sync-misa': ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R08', 'R08a'],
    '/api/employees': ['R01', 'R02', 'R02a', 'R08', 'R08a'],
    '/api/departments': ['R01', 'R02', 'R02a', 'R08', 'R08a'],
    '/api/procurement-tracking': ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R05', 'R05a', 'R07', 'R07a'],
    '/api/milestones': ['R01', 'R02', 'R02a', 'R03', 'R03a'],
    '/api/subcontracts': ['R01', 'R02', 'R02a', 'R07', 'R07a'],
    '/api/lessons': ['R01', 'R02', 'R02a'],
    '/api/safety': ['R01', 'R02', 'R02a', 'R06', 'R06a', 'R09', 'R09a'],
    '/api/reports': ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R05', 'R05a', 'R06', 'R06a', 'R07', 'R07a', 'R08', 'R08a', 'R09', 'R09a', 'R13'],
    '/api/reports/executive': ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R05', 'R05a', 'R06', 'R06a', 'R07', 'R07a', 'R08', 'R08a', 'R09', 'R09a', 'R13'],
    '/api/reports/project-profitability': ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R05', 'R05a', 'R06', 'R06a', 'R07', 'R07a', 'R08', 'R08a', 'R09', 'R09a', 'R13'],
    '/api/hr/salary': ['R01', 'R08', 'R08a'],
    '/api/hr/contracts': ['R01', 'R08', 'R08a'],
    '/api/hr/timesheets': ['R01', 'R02', 'R02a', 'R08', 'R08a'],
    '/api/hr/attendance': ['R01', 'R02', 'R02a', 'R08', 'R08a'],
    '/api/design/eco': ['R01', 'R04', 'R04a', 'R02', 'R02a', 'R06', 'R09'],
  }

  it('R06b (worker) is blocked from ALL restricted APIs', () => {
    for (const [, roles] of Object.entries(API_ROLE_MAP)) {
      expect(requireRoles('R06b', roles)).toBe(false)
    }
  })

  it('R01 (BGĐ) can access ALL APIs', () => {
    for (const [, roles] of Object.entries(API_ROLE_MAP)) {
      expect(requireRoles('R01', roles)).toBe(true)
    }
  })

  it('R09 can access QC APIs but not finance/HR salary', () => {
    expect(requireRoles('R09', API_ROLE_MAP['/api/qc/mrb'])).toBe(true)
    expect(requireRoles('R09', API_ROLE_MAP['/api/mill-certificates'])).toBe(true)
    expect(requireRoles('R09', API_ROLE_MAP['/api/finance/budgets/variance'])).toBe(false)
    expect(requireRoles('R09', API_ROLE_MAP['/api/hr/salary'])).toBe(false)
  })

  it('R07 can access procurement/reports but not QC/production', () => {
    expect(requireRoles('R07', API_ROLE_MAP['/api/procurement-tracking'])).toBe(true)
    expect(requireRoles('R07', API_ROLE_MAP['/api/purchase-orders'])).toBe(true)
    expect(requireRoles('R07', API_ROLE_MAP['/api/reports'])).toBe(true)
    expect(requireRoles('R07', API_ROLE_MAP['/api/qc/mrb'])).toBe(false)
    expect(requireRoles('R07', API_ROLE_MAP['/api/workshops'])).toBe(false)
  })

  it('R08 can access finance + HR salary/contracts but not design', () => {
    expect(requireRoles('R08', API_ROLE_MAP['/api/finance/budgets/variance'])).toBe(true)
    expect(requireRoles('R08', API_ROLE_MAP['/api/hr/salary'])).toBe(true)
    expect(requireRoles('R08', API_ROLE_MAP['/api/hr/contracts'])).toBe(true)
    expect(requireRoles('R08', API_ROLE_MAP['/api/employees'])).toBe(true)
    expect(requireRoles('R08', API_ROLE_MAP['/api/drawings'])).toBe(false)
    expect(requireRoles('R08', API_ROLE_MAP['/api/workshops'])).toBe(false)
  })

  it('R02 blocked from salary/contracts API (new matrix)', () => {
    expect(requireRoles('R02', API_ROLE_MAP['/api/hr/salary'])).toBe(false)
    expect(requireRoles('R02', API_ROLE_MAP['/api/hr/contracts'])).toBe(false)
  })

  it('R99 (unknown) blocked from ALL restricted APIs', () => {
    for (const [, roles] of Object.entries(API_ROLE_MAP)) {
      expect(requireRoles('R99', roles)).toBe(false)
    }
  })
})
