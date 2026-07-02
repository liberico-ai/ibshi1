import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db')

const { mockUser } = vi.hoisted(() => ({
  mockUser: { id: 'u1', userId: 'u1', roleCode: 'R09', fullName: 'QC Lead' },
}))

vi.mock('@/lib/auth', () => ({
  authenticateRequest: vi.fn().mockResolvedValue(mockUser),
  successResponse: vi.fn((data: unknown) => new Response(JSON.stringify({ ok: true, ...data }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
  errorResponse: vi.fn((msg: string, status = 400) => new Response(JSON.stringify({ ok: false, error: msg }), { status, headers: { 'Content-Type': 'application/json' } })),
  unauthorizedResponse: vi.fn(() => new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })),
  requireRoles: vi.fn((role: string, allowed: string[]) => allowed.includes(role)),
}))

import { prismaMock } from '@/lib/__mocks__/db'
import { authenticateRequest } from '@/lib/auth'
import { NextRequest } from 'next/server'

function makeReq(body: unknown) {
  return new NextRequest('http://localhost/api/qc/mrb/release', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function mockTx() {
  const tx = {
    mrbRelease: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    nonConformanceReport: { findMany: vi.fn().mockResolvedValue([]) },
    iTPCheckpoint: { findMany: vi.fn().mockResolvedValue([]) },
    inspection: { findMany: vi.fn().mockResolvedValue([
      { id: 'i1', inspectionCode: 'INS-001', type: 'FAT', status: 'PASSED' },
    ]) },
    workOrder: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  }
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx))
  return tx
}

beforeEach(() => {
  prismaMock.project.findUnique.mockResolvedValue({
    id: 'p1', projectCode: 'PRJ-001', projectName: 'Test',
  } as never)
})

describe('POST /api/qc/mrb/release', () => {
  it('RBAC: R06 bị chặn 403', async () => {
    vi.mocked(authenticateRequest).mockResolvedValueOnce({ id: 'u2', userId: 'u2', roleCode: 'R06', fullName: 'SX' } as never)
    const { POST } = await import('@/app/api/qc/mrb/release/route')
    const res = await POST(makeReq({ projectId: 'p1' }))
    expect(res.status).toBe(403)
  })

  it('release thành công — tạo MrbRelease rev 1', async () => {
    const tx = mockTx()
    tx.mrbRelease.findFirst.mockResolvedValue(null)
    tx.mrbRelease.create.mockResolvedValue({ id: 'mr1', projectId: 'p1', revision: 1, status: 'RELEASED' })
    const { POST } = await import('@/app/api/qc/mrb/release/route')
    const res = await POST(makeReq({ projectId: 'p1' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.release.revision).toBe(1)
    expect(body.reused).toBe(false)
    expect(tx.auditLog.create).toHaveBeenCalled()
  })

  it('idempotent — đã RELEASED → trả bản cũ', async () => {
    const tx = mockTx()
    tx.mrbRelease.findFirst.mockResolvedValue({ id: 'mr1', projectId: 'p1', revision: 1, status: 'RELEASED' })
    const { POST } = await import('@/app/api/qc/mrb/release/route')
    const res = await POST(makeReq({ projectId: 'p1' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.reused).toBe(true)
    expect(tx.mrbRelease.create).not.toHaveBeenCalled()
  })

  it('reissue — latest SUPERSEDED → tạo rev+1', async () => {
    const tx = mockTx()
    tx.mrbRelease.findFirst.mockResolvedValue({ id: 'mr1', projectId: 'p1', revision: 1, status: 'SUPERSEDED' })
    tx.mrbRelease.create.mockResolvedValue({ id: 'mr2', projectId: 'p1', revision: 2, status: 'RELEASED' })
    const { POST } = await import('@/app/api/qc/mrb/release/route')
    const res = await POST(makeReq({ projectId: 'p1' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.release.revision).toBe(2)
    expect(tx.mrbRelease.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'mr1' },
      data: { status: 'SUPERSEDED' },
    }))
  })

  it('BLOCK khi có NCR mở → 422', async () => {
    const tx = mockTx()
    tx.mrbRelease.findFirst.mockResolvedValue(null)
    tx.nonConformanceReport.findMany.mockResolvedValue([{ ncrCode: 'NCR-001', status: 'OPEN' }])
    const { POST } = await import('@/app/api/qc/mrb/release/route')
    const res = await POST(makeReq({ projectId: 'p1' }))
    const body = await res.json()
    expect(res.status).toBe(422)
    expect(body.error).toContain('NCR')
  })

  it('BLOCK khi thiếu FAT PASSED → 422', async () => {
    const tx = mockTx()
    tx.mrbRelease.findFirst.mockResolvedValue(null)
    tx.inspection.findMany.mockResolvedValue([
      { id: 'i1', inspectionCode: 'INS-001', type: 'VISUAL', status: 'PASSED' },
    ])
    const { POST } = await import('@/app/api/qc/mrb/release/route')
    const res = await POST(makeReq({ projectId: 'p1' }))
    const body = await res.json()
    expect(res.status).toBe(422)
    expect(body.error).toContain('FAT')
  })

  it('BLOCK khi có WO cần re-QC → 422', async () => {
    const tx = mockTx()
    tx.mrbRelease.findFirst.mockResolvedValue(null)
    tx.workOrder.findMany.mockResolvedValue([{ woCode: 'WO-ECO-001' }])
    const { POST } = await import('@/app/api/qc/mrb/release/route')
    const res = await POST(makeReq({ projectId: 'p1' }))
    const body = await res.json()
    expect(res.status).toBe(422)
    expect(body.error).toContain('re-QC')
    expect(body.error).toContain('WO-ECO-001')
  })

  it('MDR chặn khi chưa có MrbRelease RELEASED', async () => {
    prismaMock.mrbRelease.findFirst.mockResolvedValue(null as never)
    prismaMock.nonConformanceReport.findMany.mockResolvedValue([] as never)
    prismaMock.iTPCheckpoint.findMany.mockResolvedValue([] as never)
    prismaMock.inspection.findMany.mockResolvedValue([] as never)
    prismaMock.packingList.findMany.mockResolvedValue([] as never)
    prismaMock.shipment.findMany.mockResolvedValue([] as never)

    const { GET } = await import('@/app/api/logistics/mdr/route')
    const req = new NextRequest('http://localhost/api/logistics/mdr?projectId=p1')
    const res = await GET(req)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.canRelease).toBe(false)
    expect(body.blockers.some((b: string) => b.includes('MRB'))).toBe(true)
  })
})
