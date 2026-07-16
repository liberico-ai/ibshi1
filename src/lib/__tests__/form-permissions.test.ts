import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db')

const { mockAuthPayload } = vi.hoisted(() => ({
  mockAuthPayload: { userId: 'u1', roleCode: 'R02', fullName: 'Test PM' },
}))

vi.mock('@/lib/auth', () => ({
  authenticateRequest: vi.fn().mockResolvedValue(mockAuthPayload),
  successResponse: vi.fn((data: unknown) => new Response(JSON.stringify({ ok: true, ...data }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
  errorResponse: vi.fn((msg: string, status: number) => new Response(JSON.stringify({ ok: false, error: msg }), { status, headers: { 'Content-Type': 'application/json' } })),
  unauthorizedResponse: vi.fn(() => new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })),
}))

import { prismaMock } from '@/lib/__mocks__/db'
import { canEditForm } from '@/lib/constants'
import { POST } from '@/app/api/work/tasks/[id]/result-data/route'
import { POST as POST_BOM_PR } from '@/app/api/work/tasks/[id]/bom-pr/route'
import { authenticateRequest } from '@/lib/auth'
import { NextRequest } from 'next/server'

function makeReq(body: unknown) {
  return new NextRequest('http://localhost/api/work/tasks/t1/result-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('canEditForm', () => {
  it('R03 can edit ESTIMATE', () => expect(canEditForm('ESTIMATE', 'R03')).toBe(true))
  it('R03a can edit ESTIMATE', () => expect(canEditForm('ESTIMATE', 'R03a')).toBe(true))
  it('R06 cannot edit ESTIMATE', () => expect(canEditForm('ESTIMATE', 'R06')).toBe(false))
  it('R07 cannot edit ESTIMATE', () => expect(canEditForm('ESTIMATE', 'R07')).toBe(false))
  it('R02 can edit WBS', () => expect(canEditForm('WBS', 'R02')).toBe(true))
  it('R04 cannot edit WBS', () => expect(canEditForm('WBS', 'R04')).toBe(false))
  it('R02 can edit BBH', () => expect(canEditForm('BBH', 'R02')).toBe(true))
  it('R04 can edit BOM', () => expect(canEditForm('BOM', 'R04')).toBe(true))
  it('R02 cannot edit BOM', () => expect(canEditForm('BOM', 'R02')).toBe(false))
  it('R04 can edit WELD_PAINT', () => expect(canEditForm('WELD_PAINT', 'R04')).toBe(true))
  it('R07 can edit SUPPLIER_QUOTE', () => expect(canEditForm('SUPPLIER_QUOTE', 'R07')).toBe(true))
  it('R03 cannot edit SUPPLIER_QUOTE', () => expect(canEditForm('SUPPLIER_QUOTE', 'R03')).toBe(false))
  it('R01 can edit everything', () => {
    const forms = ['ESTIMATE', 'PR', 'BBH', 'WBS', 'WELD_PAINT', 'BOM', 'SUPPLIER_QUOTE'] as const
    for (const f of forms) expect(canEditForm(f, 'R01')).toBe(true)
  })
  it('R02 can edit PR', () => expect(canEditForm('PR', 'R02')).toBe(true))
  // Gap #3: R07/R07a (Thương mại) ghi bomPr đường chính ở P3.5 (procurement)
  it('R07 can edit PR (bomPr, P3.5)', () => expect(canEditForm('PR', 'R07')).toBe(true))
  it('R07a can edit PR (bomPr, P3.5)', () => expect(canEditForm('PR', 'R07a')).toBe(true))
  it('R06 cannot edit PR', () => expect(canEditForm('PR', 'R06')).toBe(false))
})

describe('POST /result-data — server gate', () => {
  const taskData = {
    id: 't1', resultData: {}, createdBy: 'u1',
    assignees: [{ userId: 'u1', role: 'R02' }],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(mockAuthPayload as any)
    prismaMock.task.findUnique.mockResolvedValue(taskData as any)
    prismaMock.$executeRaw.mockResolvedValue(1 as any)
  })

  it('R06 saving wbsItems → 403', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ userId: 'u2', roleCode: 'R06', fullName: 'SX' } as any)
    prismaMock.task.findUnique.mockResolvedValue({
      ...taskData, assignees: [{ userId: 'u2', role: 'R06' }],
    } as any)

    const res = await POST(makeReq({ key: 'wbsItems', value: '[]' }), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(403)
  })

  it('R02 saving wbsItems → 200', async () => {
    const res = await POST(makeReq({ key: 'wbsItems', value: '[]' }), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(200)
  })

  it('non-participant → 403 (IDOR block)', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ userId: 'stranger', roleCode: 'R08', fullName: 'X' } as any)
    prismaMock.task.findUnique.mockResolvedValue({
      ...taskData, createdBy: 'other', assignees: [{ userId: 'u1', role: 'R02' }],
    } as any)

    const res = await POST(makeReq({ key: 'wbsItems', value: '[]' }), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(403)
  })

  it('templateType is allowed for any assignee (no form gate)', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ userId: 'u1', roleCode: 'R06', fullName: 'SX' } as any)
    prismaMock.task.findUnique.mockResolvedValue({
      ...taskData, assignees: [{ userId: 'u1', role: 'R06' }],
    } as any)

    const res = await POST(makeReq({ key: 'templateType', value: 'WBS' }), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(200)
  })

  it('R07 saving totalEstimate → 403', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ userId: 'u1', roleCode: 'R07', fullName: 'TM' } as any)
    prismaMock.task.findUnique.mockResolvedValue({
      ...taskData, assignees: [{ userId: 'u1', role: 'R07' }],
    } as any)

    const res = await POST(makeReq({ key: 'totalEstimate', value: 1000 }), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(403)
  })
})

describe('POST /result-data — chosenVendorId reason enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue({ userId: 'u1', roleCode: 'R07', fullName: 'TM' } as any)
    prismaMock.$executeRaw.mockResolvedValue(1 as any)
  })

  it('<2 priced quotes → no reason required', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: 't1', resultData: {
        supplierQuotes: [
          { vendorId: 'v1', totalAmount: 100, selectReason: '' },
          { vendorId: 'v2', totalAmount: 0 },
        ],
      }, createdBy: 'u1', assignees: [{ userId: 'u1', role: 'R07' }],
    } as any)

    const res = await POST(makeReq({ key: 'chosenVendorId', value: 'v1' }), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(200)
  })

  it('>=2 priced + not min + no reason → 400', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: 't1', resultData: {
        supplierQuotes: [
          { vendorId: 'v1', totalAmount: 200, selectReason: '' },
          { vendorId: 'v2', totalAmount: 100 },
        ],
      }, createdBy: 'u1', assignees: [{ userId: 'u1', role: 'R07' }],
    } as any)

    const res = await POST(makeReq({ key: 'chosenVendorId', value: 'v1' }), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/lý do/)
  })

  it('>=2 priced + is min → no reason required', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: 't1', resultData: {
        supplierQuotes: [
          { vendorId: 'v1', totalAmount: 50, selectReason: '' },
          { vendorId: 'v2', totalAmount: 100 },
        ],
      }, createdBy: 'u1', assignees: [{ userId: 'u1', role: 'R07' }],
    } as any)

    const res = await POST(makeReq({ key: 'chosenVendorId', value: 'v1' }), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(200)
  })
})

describe('POST /bom-pr — server gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(mockAuthPayload as any)
    prismaMock.task.findUnique.mockResolvedValue({
      id: 't1', createdBy: 'u1', assignees: [{ userId: 'u1', role: 'R02' }],
    } as any)
    prismaMock.$executeRaw.mockResolvedValue(1 as any)
  })

  // Gap #3: R07 (Thương mại) là PARTICIPANT của task (creator/assignee) → ghi bomPr được (form-gate PR đã nới R07).
  it('R07 là participant → 200', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ userId: 'u1', roleCode: 'R07', fullName: 'TM' } as any)

    const req = new NextRequest('http://localhost/api/work/tasks/t1/bom-pr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: '[]' }),
    })
    const res = await POST_BOM_PR(req, { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(200)
  })

  // ⚠️ Chặn RÒ RỈ QUYỀN: R07 KHÔNG phải participant (task của bước khác, vd P2.1 design) → 403 ở row-level,
  // TRƯỚC form-gate. Nới form-gate KHÔNG cho R07 sửa bomPr ở task người khác.
  it('R07 KHÔNG participant → 403 (row-level, không phải form)', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ userId: 'u1', roleCode: 'R07', fullName: 'TM' } as any)
    prismaMock.task.findUnique.mockResolvedValue({
      id: 't1', createdBy: 'other-user', assignees: [{ userId: 'r04-user', role: 'R04' }],
    } as any)

    const req = new NextRequest('http://localhost/api/work/tasks/t1/bom-pr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: '[]' }),
    })
    const res = await POST_BOM_PR(req, { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(403)
  })

  it('R02 → 200', async () => {
    const req = new NextRequest('http://localhost/api/work/tasks/t1/bom-pr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: '[]' }),
    })
    const res = await POST_BOM_PR(req, { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(200)
  })
})
