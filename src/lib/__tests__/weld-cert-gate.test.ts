import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'

import { isCertValid } from '../weld-cert-gate'

const tomorrow = new Date(Date.now() + 86_400_000)
const yesterday = new Date(Date.now() - 86_400_000)
const in10Days = new Date(Date.now() + 10 * 86_400_000)

function makeCert(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cert1',
    certType: 'welder_cert',
    certNumber: 'WC-001',
    holderName: 'Nguyen Van A',
    holderId: 'welder1',
    issuedBy: 'Bureau Veritas',
    issueDate: new Date('2025-01-01'),
    expiryDate: tomorrow,
    standard: 'AWS D1.1',
    scope: 'SMAW',
    fileUrl: null,
    isActive: true,
    renewedFromId: null,
    createdAt: new Date(),
    ...overrides,
  }
}

describe('isCertValid', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('cert còn hạn + đúng type → valid', async () => {
    prismaMock.certificateRegistry.findUnique.mockResolvedValue(makeCert() as never)
    const result = await isCertValid('cert1', 'welder_cert')
    expect(result.valid).toBe(true)
    expect(result.reason).toBeNull()
  })

  it('cert hết hạn → chặn', async () => {
    prismaMock.certificateRegistry.findUnique.mockResolvedValue(makeCert({ expiryDate: yesterday }) as never)
    const result = await isCertValid('cert1', 'welder_cert')
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/hết hạn/)
  })

  it('isActive=false → chặn', async () => {
    prismaMock.certificateRegistry.findUnique.mockResolvedValue(makeCert({ isActive: false }) as never)
    const result = await isCertValid('cert1', 'welder_cert')
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/thu hồi/)
  })

  it('certType sai → chặn', async () => {
    prismaMock.certificateRegistry.findUnique.mockResolvedValue(makeCert({ certType: 'ndt_cert' }) as never)
    const result = await isCertValid('cert1', 'welder_cert')
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/loại ndt_cert, cần welder_cert/)
  })

  it('holderId lệch → warning (không chặn)', async () => {
    prismaMock.certificateRegistry.findUnique.mockResolvedValue(makeCert({ holderId: 'other-welder' }) as never)
    const result = await isCertValid('cert1', 'welder_cert', 'welder1')
    expect(result.valid).toBe(true)
    expect(result.warning).toMatch(/thuộc người khác/)
  })

  it('<30 ngày hết hạn → warning (không chặn)', async () => {
    prismaMock.certificateRegistry.findUnique.mockResolvedValue(makeCert({ expiryDate: in10Days }) as never)
    const result = await isCertValid('cert1', 'welder_cert')
    expect(result.valid).toBe(true)
    expect(result.warning).toMatch(/còn \d+ ngày/)
  })

  it('cert không tồn tại → chặn', async () => {
    prismaMock.certificateRegistry.findUnique.mockResolvedValue(null as never)
    const result = await isCertValid('nonexist', 'welder_cert')
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/không tồn tại/)
  })

  it('wps cert hợp lệ → valid', async () => {
    prismaMock.certificateRegistry.findUnique.mockResolvedValue(makeCert({ certType: 'wps' }) as never)
    const result = await isCertValid('cert1', 'wps')
    expect(result.valid).toBe(true)
  })
})
