import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prismaMock } from '@/lib/__mocks__/db'

const { mockAuthUser } = vi.hoisted(() => ({
  mockAuthUser: {
    userId: 'user-1',
    roleCode: 'R06',
    username: 'sanxuat',
    userLevel: 2,
    fullName: 'Trưởng phòng SX',
  },
}))

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return {
    ...actual,
    authenticateRequest: vi.fn().mockResolvedValue(mockAuthUser),
    logAudit: vi.fn().mockResolvedValue(undefined),
    getClientIP: vi.fn().mockReturnValue('127.0.0.1'),
  }
})

import { POST } from '@/app/api/production/work-orders/from-bom/route'
import { authenticateRequest } from '@/lib/auth'

const SAMPLE_PROJECT = { id: 'proj-1', projectCode: 'P-001' }

const SAMPLE_VERSION = {
  id: 'bomver-1',
  lines: [
    { pieceMark: 'C1' },
    { pieceMark: 'C1' }, // trùng — chỉ tạo 1 WO
    { pieceMark: 'B2' },
    { pieceMark: null }, // không piece-mark — bỏ qua
    { pieceMark: '  ' }, // rỗng — bỏ qua
  ],
}

function makeReq(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/production/work-orders/from-bom', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/production/work-orders/from-bom', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(mockAuthUser)
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue(null)
    const res = await POST(makeReq({ projectId: 'proj-1' }), {})
    expect(res.status).toBe(401)
  })

  it('returns 403 for roles without permission (R05)', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ...mockAuthUser, roleCode: 'R05' })
    const res = await POST(makeReq({ projectId: 'proj-1' }), {})
    expect(res.status).toBe(403)
  })

  it('returns error when project has no ACTIVE BOM version', async () => {
    prismaMock.project.findUnique.mockResolvedValue(SAMPLE_PROJECT as never)
    prismaMock.bomVersion.findFirst.mockResolvedValue(null)

    const res = await POST(makeReq({ projectId: 'proj-1' }), {})
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  it('creates one WO per unique piece-mark (skips empty/duplicate marks)', async () => {
    prismaMock.project.findUnique.mockResolvedValue(SAMPLE_PROJECT as never)
    prismaMock.bomVersion.findFirst.mockResolvedValue(SAMPLE_VERSION as never)
    prismaMock.workOrder.findMany.mockResolvedValue([] as never)
    prismaMock.workOrder.createMany.mockResolvedValue({ count: 2 } as never)

    const res = await POST(makeReq({ projectId: 'proj-1' }), {})
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.created).toBe(2)
    expect(json.skipped).toBe(0)

    expect(prismaMock.workOrder.createMany).toHaveBeenCalledTimes(1)
    const arg = prismaMock.workOrder.createMany.mock.calls[0][0] as { data: Array<Record<string, unknown>> }
    expect(arg.data).toHaveLength(2)
    expect(arg.data.map(d => d.pieceMark)).toEqual(['C1', 'B2'])
    expect(arg.data[0].woCode).toBe('WO-P-001-C1')
    expect(arg.data[0].bomVersionId).toBe('bomver-1')
  })

  it('is idempotent: second call creates 0 (all piece-marks already have WO)', async () => {
    prismaMock.project.findUnique.mockResolvedValue(SAMPLE_PROJECT as never)
    prismaMock.bomVersion.findFirst.mockResolvedValue(SAMPLE_VERSION as never)

    // Lần 1: chưa có WO nào → tạo 2
    prismaMock.workOrder.findMany.mockResolvedValueOnce([] as never)
    prismaMock.workOrder.createMany.mockResolvedValue({ count: 2 } as never)

    const res1 = await POST(makeReq({ projectId: 'proj-1' }), {})
    const json1 = await res1.json()
    expect(json1.created).toBe(2)
    expect(json1.skipped).toBe(0)

    // Lần 2: cả 2 piece-mark đã có WO → created=0, không gọi createMany nữa
    prismaMock.workOrder.findMany.mockResolvedValueOnce([
      { pieceMark: 'C1' },
      { pieceMark: 'B2' },
    ] as never)

    const res2 = await POST(makeReq({ projectId: 'proj-1' }), {})
    const json2 = await res2.json()
    expect(json2.ok).toBe(true)
    expect(json2.created).toBe(0)
    expect(json2.skipped).toBe(2)
    expect(prismaMock.workOrder.createMany).toHaveBeenCalledTimes(1) // chỉ từ lần 1
  })

  it('rejects bomVersionId belonging to another project', async () => {
    prismaMock.project.findUnique.mockResolvedValue(SAMPLE_PROJECT as never)
    prismaMock.bomVersion.findUnique.mockResolvedValue({
      ...SAMPLE_VERSION,
      bom: { projectId: 'proj-OTHER' },
    } as never)

    const res = await POST(makeReq({ projectId: 'proj-1', bomVersionId: 'bomver-1' }), {})
    const json = await res.json()
    expect(json.ok).toBe(false)
  })
})
