import { describe, it, expect, vi, beforeEach } from 'vitest'
import { evaluate } from '../can'

// ── Lõi thuần: thứ tự ưu tiên DENY > ALLOW > level > role ──
describe('evaluate() — thứ tự ưu tiên', () => {
  it('sàn admin thắng tất cả', () => {
    expect(evaluate({ adminFloor: true, override: 'DENY', levelBlocked: true, roleHas: false })).toBe(true)
  })
  it('DENY thắng ALLOW-của-role và level', () => {
    expect(evaluate({ override: 'DENY', roleHas: true })).toBe(false)
  })
  it('ALLOW cấp thêm dù role không có', () => {
    expect(evaluate({ override: 'ALLOW', roleHas: false })).toBe(true)
  })
  it('ALLOW vượt qua chặn level', () => {
    expect(evaluate({ override: 'ALLOW', levelBlocked: true, roleHas: false })).toBe(true)
  })
  it('level chặn dù role có', () => {
    expect(evaluate({ levelBlocked: true, roleHas: true })).toBe(false)
  })
  it('không override, không level → theo role', () => {
    expect(evaluate({ roleHas: true })).toBe(true)
    expect(evaluate({ roleHas: false })).toBe(false)
  })
})

// ── can() end-to-end với store được mock ──
vi.mock('../store', () => ({
  getRoleGrants: vi.fn(),
  getUserOverrides: vi.fn(),
  getStepLevels: vi.fn(),
}))
import { can, getEffectiveCapabilities } from '../can'
import { getRoleGrants, getUserOverrides, getStepLevels } from '../store'

const mocked = {
  roleGrants: getRoleGrants as unknown as ReturnType<typeof vi.fn>,
  overrides: getUserOverrides as unknown as ReturnType<typeof vi.fn>,
  levels: getStepLevels as unknown as ReturnType<typeof vi.fn>,
}

describe('can() — tích hợp', () => {
  beforeEach(() => {
    mocked.roleGrants.mockResolvedValue(new Set<string>())
    mocked.overrides.mockResolvedValue({})
    mocked.levels.mockResolvedValue({})
  })

  const R06b = { userId: 'u1', roleCode: 'R06b', userLevel: 2 }
  const R10 = { userId: 'admin', roleCode: 'R10', userLevel: 1 }

  it('R10 không bao giờ mất quyền quản lý phân quyền (sàn an toàn)', async () => {
    mocked.roleGrants.mockResolvedValue(new Set<string>())        // role trống
    mocked.overrides.mockResolvedValue({ 'admin.manage_permissions': 'DENY' }) // cố tình DENY
    expect(await can(R10, 'admin.manage_permissions')).toBe(true)
  })

  it('vai trò có capability → cho', async () => {
    mocked.roleGrants.mockResolvedValue(new Set(['production.report_output']))
    expect(await can(R06b, 'production.report_output')).toBe(true)
  })

  it('DENY riêng thu hồi quyền của vai trò', async () => {
    mocked.roleGrants.mockResolvedValue(new Set(['production.report_output']))
    mocked.overrides.mockResolvedValue({ 'production.report_output': 'DENY' })
    expect(await can(R06b, 'production.report_output')).toBe(false)
  })

  it('ALLOW riêng cấp thêm quyền ngoài vai trò', async () => {
    mocked.roleGrants.mockResolvedValue(new Set<string>())
    mocked.overrides.mockResolvedValue({ 'qc.record_verdict': 'ALLOW' })
    expect(await can(R06b, 'qc.record_verdict')).toBe(true)
  })

  it('bước yêu cầu L1 chặn user L2 dù vai trò có', async () => {
    mocked.roleGrants.mockResolvedValue(new Set(['approve.week']))
    mocked.levels.mockResolvedValue({ 'P5.4': { minLevel: 1 } })
    expect(await can(R06b, 'approve.week', { stepCode: 'P5.4' })).toBe(false)   // L2 bị chặn
    expect(await can({ ...R06b, userLevel: 1 }, 'approve.week', { stepCode: 'P5.4' })).toBe(true) // L1 qua
  })

  it('getEffectiveCapabilities: cộng ALLOW, trừ DENY', async () => {
    mocked.roleGrants.mockResolvedValue(new Set(['a', 'b']))
    mocked.overrides.mockResolvedValue({ b: 'DENY', c: 'ALLOW' })
    const eff = await getEffectiveCapabilities(R06b)
    expect(eff).toEqual(['a', 'c'])
  })
})
