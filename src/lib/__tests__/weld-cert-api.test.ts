import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prismaMock } from '@/lib/__mocks__/db'

const mockAuth = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>()
  return { ...actual, authenticateRequest: (...a: unknown[]) => mockAuth(...a) }
})

import { POST as weldMapPOST } from '@/app/api/production/weld-map/route'
import { PUT as weldMapPUT } from '@/app/api/production/weld-map/[id]/route'
import { computeMrbGate } from '@/lib/mrb-gate'

const QC_USER = { userId: 'u1', username: 'qc', roleCode: 'R09', userLevel: 2, fullName: 'QC User' }
const tomorrow = new Date(Date.now() + 86_400_000)
const yesterday = new Date(Date.now() - 86_400_000)

function makeReq(url: string, body: object) {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function makePutReq(url: string, body: object) {
  return new NextRequest(url, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  mockAuth.mockResolvedValue(QC_USER)
})

describe('POST /api/production/weld-map cert gate', () => {
  it('cert hết hạn → 400', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({ id: 'wo1' } as never)
    prismaMock.certificateRegistry.findUnique.mockResolvedValue({
      id: 'cert1', certType: 'welder_cert', certNumber: 'WC-001',
      holderName: 'A', holderId: null, isActive: true,
      expiryDate: yesterday, issueDate: new Date(), createdAt: new Date(),
      standard: null, scope: null, fileUrl: null, renewedFromId: null, issuedBy: 'BV',
    } as never)

    const res = await weldMapPOST(makeReq('http://localhost/api/production/weld-map', {
      workOrderId: 'wo1', jointNo: 'J1', welderCertId: 'cert1',
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/hết hạn/)
  })

  it('cert hợp lệ → 200', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({ id: 'wo1' } as never)
    prismaMock.certificateRegistry.findUnique.mockResolvedValue({
      id: 'cert1', certType: 'welder_cert', certNumber: 'WC-001',
      holderName: 'A', holderId: null, isActive: true,
      expiryDate: tomorrow, issueDate: new Date(), createdAt: new Date(),
      standard: null, scope: null, fileUrl: null, renewedFromId: null, issuedBy: 'BV',
    } as never)
    prismaMock.weldJoint.create.mockResolvedValue({
      id: 'j1', jointNo: 'J1', status: 'PENDING', welder: null,
    } as never)

    const res = await weldMapPOST(makeReq('http://localhost/api/production/weld-map', {
      workOrderId: 'wo1', jointNo: 'J1', welderCertId: 'cert1',
    }))
    expect(res.status).toBe(200)
  })
})

describe('PUT /api/production/weld-map/[id] — status=WELDED cert gate', () => {
  it('status=WELDED + cert hết hạn trên joint → 400', async () => {
    prismaMock.weldJoint.findUnique.mockResolvedValue({
      id: 'j1', jointNo: 'J1', workOrderId: 'wo1', status: 'PENDING',
      welderId: 'w1', welderCertId: 'cert-expired', wpsCertId: null,
    } as never)
    prismaMock.certificateRegistry.findUnique.mockResolvedValue({
      id: 'cert-expired', certType: 'welder_cert', certNumber: 'WC-X',
      holderName: 'A', holderId: null, isActive: true,
      expiryDate: yesterday, issueDate: new Date(), createdAt: new Date(),
      standard: null, scope: null, fileUrl: null, renewedFromId: null, issuedBy: 'BV',
    } as never)

    const res = await weldMapPUT(
      makePutReq('http://localhost/api/production/weld-map/j1', { status: 'WELDED' }),
      { params: Promise.resolve({ id: 'j1' }) },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/WELDED/)
  })
})

describe('MRB gate — weld cert warning', () => {
  it('mối hàn dùng cert hết hạn → warning', async () => {
    prismaMock.nonConformanceReport.findMany.mockResolvedValue([])
    prismaMock.iTPCheckpoint.findMany.mockResolvedValue([])
    prismaMock.inspection.findMany.mockResolvedValue([
      { id: 'i1', inspectionCode: 'INS-001', type: 'FAT', status: 'PASSED' },
    ] as never)

    prismaMock.weldJoint.findMany.mockResolvedValue([
      { jointNo: 'J1', welderCertId: 'cert-exp', wpsCertId: null },
    ] as never)

    prismaMock.certificateRegistry.findMany.mockResolvedValue([
      { id: 'cert-exp', certNumber: 'WC-001', certType: 'welder_cert' },
    ] as never)

    const result = await computeMrbGate('proj1')
    expect(result.warnings.some(w => w.includes('hết hạn/thu hồi'))).toBe(true)
  })
})
