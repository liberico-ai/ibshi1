import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db')

import { prismaMock } from '@/lib/__mocks__/db'
import { getRetentionDays, purgeOldLogs } from '../log-retention'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getRetentionDays', () => {
  it('không có config → mặc định 90', async () => {
    prismaMock.systemConfig.findUnique.mockResolvedValue(null as never)
    expect(await getRetentionDays()).toBe(90)
  })

  it('giá trị hợp lệ → dùng nguyên', async () => {
    prismaMock.systemConfig.findUnique.mockResolvedValue({ key: 'log_retention_days', value: '30' } as never)
    expect(await getRetentionDays()).toBe(30)
  })

  it('dưới 7 → kẹp 7; trên 3650 → kẹp 3650; rác → 90', async () => {
    prismaMock.systemConfig.findUnique.mockResolvedValue({ value: '3' } as never)
    expect(await getRetentionDays()).toBe(7)
    prismaMock.systemConfig.findUnique.mockResolvedValue({ value: '999999' } as never)
    expect(await getRetentionDays()).toBe(3650)
    prismaMock.systemConfig.findUnique.mockResolvedValue({ value: 'abc' } as never)
    expect(await getRetentionDays()).toBe(90)
  })
})

describe('purgeOldLogs', () => {
  it('dryRun → chỉ đếm, KHÔNG xóa', async () => {
    prismaMock.systemConfig.findUnique.mockResolvedValue({ value: '90' } as never)
    prismaMock.auditLog.count.mockResolvedValue(12 as never)
    prismaMock.errorLog.count.mockResolvedValue(3 as never)

    const r = await purgeOldLogs({ dryRun: true })
    expect(r.dryRun).toBe(true)
    expect(r.auditLogs).toBe(12)
    expect(r.errorLogs).toBe(3)
    expect(r.retentionDays).toBe(90)
    expect(prismaMock.auditLog.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.errorLog.deleteMany).not.toHaveBeenCalled()
  })

  it('xóa thật → xóa theo batch, trả số đã xóa', async () => {
    prismaMock.systemConfig.findUnique.mockResolvedValue({ value: '90' } as never)
    // audit: 1 batch nhỏ (2 id < BATCH) → findMany 1 lần, deleteMany 1 lần
    prismaMock.auditLog.findMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }] as never)
    prismaMock.auditLog.deleteMany.mockResolvedValue({ count: 2 } as never)
    // error: rỗng → không xóa
    prismaMock.errorLog.findMany.mockResolvedValue([] as never)

    const r = await purgeOldLogs()
    expect(r.dryRun).toBe(false)
    expect(r.auditLogs).toBe(2)
    expect(r.errorLogs).toBe(0)
    expect(prismaMock.auditLog.deleteMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.errorLog.deleteMany).not.toHaveBeenCalled()
  })
})
