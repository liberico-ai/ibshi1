/**
 * Tests cho /api/purchase-requests (Đợt 2D — truy vết PR phát sinh từ ECO/NCR)
 *
 * - POST PR với origin (ECO/NCR) → lưu đúng originType/originId/originLabel
 * - POST origin enum sai → 400, không tạo PR
 * - GET lọc theo originType + originId
 * - PR không origin → origin fields null (flow cũ không vỡ)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prismaMock } from '@/lib/__mocks__/db'

const { mockAuthUser } = vi.hoisted(() => ({
  mockAuthUser: {
    userId: 'user-1',
    roleCode: 'R02', // PM — được tạo PR
    username: 'pm',
    userLevel: 1,
    fullName: 'PM User',
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

import { GET as getPrs, POST as postPr } from '@/app/api/purchase-requests/route'
import { authenticateRequest } from '@/lib/auth'

function postReq(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/purchase-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function getReq(query = '') {
  return new NextRequest(`http://localhost/api/purchase-requests${query}`)
}

const BASE_BODY = {
  projectId: 'proj-1',
  items: [{ materialId: 'mat-1', quantity: 5 }],
}

/** create trả lại đúng data được truyền vào (mô phỏng DB echo) */
function mockCreateEcho() {
  prismaMock.purchaseRequest.create.mockImplementation((async (args: { data: Record<string, unknown> }) => ({
    id: 'pr-1',
    ...args.data,
    items: [],
    project: { projectCode: 'PRJ-01', projectName: 'Du an 1' },
  })) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateRequest).mockResolvedValue(mockAuthUser)
  prismaMock.purchaseRequest.findFirst.mockResolvedValue(null) // chưa có PR nào → PR-YY-001
  mockCreateEcho()
})

describe('POST /api/purchase-requests — origin trace', () => {
  it('PR với origin ECO → lưu originType/originId/originLabel', async () => {
    const res = await postPr(postReq({
      ...BASE_BODY,
      originType: 'ECO',
      originId: 'bomver-1',
      originLabel: 'ECO-26-001',
    }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.ok).toBe(true)

    const createCall = prismaMock.purchaseRequest.create.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(createCall.data).toMatchObject({
      projectId: 'proj-1',
      originType: 'ECO',
      originId: 'bomver-1',
      originLabel: 'ECO-26-001',
    })
    expect(json.purchaseRequest.originType).toBe('ECO')
    expect(json.purchaseRequest.originLabel).toBe('ECO-26-001')
  })

  it('PR với origin NCR → lưu đúng nguồn NCR', async () => {
    const res = await postPr(postReq({
      ...BASE_BODY,
      originType: 'NCR',
      originId: 'ncr-1',
      originLabel: 'NCR-26-003',
    }))
    expect(res.status).toBe(201)

    const createCall = prismaMock.purchaseRequest.create.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(createCall.data).toMatchObject({ originType: 'NCR', originId: 'ncr-1', originLabel: 'NCR-26-003' })
  })

  it('originType không hợp lệ (ngoài ECO|NCR) → 400, không tạo PR', async () => {
    const res = await postPr(postReq({ ...BASE_BODY, originType: 'FOO', originId: 'x-1' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(prismaMock.purchaseRequest.create).not.toHaveBeenCalled()
  })

  it('PR không có origin → origin fields = null (flow cũ không vỡ)', async () => {
    const res = await postPr(postReq(BASE_BODY))
    expect(res.status).toBe(201)

    const createCall = prismaMock.purchaseRequest.create.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(createCall.data.originType).toBeNull()
    expect(createCall.data.originId).toBeNull()
    expect(createCall.data.originLabel).toBeNull()
  })

  it('role không được tạo PR (R06) → 403', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ...mockAuthUser, roleCode: 'R06' })
    const res = await postPr(postReq(BASE_BODY))
    expect(res.status).toBe(403)
    expect(prismaMock.purchaseRequest.create).not.toHaveBeenCalled()
  })
})

describe('GET /api/purchase-requests — lọc theo origin', () => {
  it('?originType=NCR&originId=ncr-1 → where có đúng cặp origin', async () => {
    prismaMock.purchaseRequest.count.mockResolvedValue(1)
    prismaMock.purchaseRequest.findMany.mockResolvedValue([
      {
        id: 'pr-1', prCode: 'PR-26-001', projectId: 'proj-1', requestedBy: 'user-1',
        status: 'SUBMITTED', urgency: 'NORMAL', notes: null,
        approvedBy: null, approvedAt: null,
        originType: 'NCR', originId: 'ncr-1', originLabel: 'NCR-26-003',
        createdAt: new Date(), updatedAt: new Date(),
        project: { projectCode: 'PRJ-01', projectName: 'Du an 1' },
        items: [],
      },
    ] as never)

    const res = await getPrs(getReq('?originType=NCR&originId=ncr-1'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.purchaseRequests).toHaveLength(1)
    expect(json.purchaseRequests[0].originLabel).toBe('NCR-26-003')

    const findCall = prismaMock.purchaseRequest.findMany.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(findCall.where).toMatchObject({ originType: 'NCR', originId: 'ncr-1' })
  })

  it('GET không filter origin → where không chứa origin (flow cũ)', async () => {
    prismaMock.purchaseRequest.count.mockResolvedValue(0)
    prismaMock.purchaseRequest.findMany.mockResolvedValue([] as never)

    const res = await getPrs(getReq())
    expect(res.status).toBe(200)

    const findCall = prismaMock.purchaseRequest.findMany.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(findCall.where).not.toHaveProperty('originType')
    expect(findCall.where).not.toHaveProperty('originId')
  })

  it('?originType=BAD → 400 (validate enum ở query)', async () => {
    const res = await getPrs(getReq('?originType=BAD'))
    expect(res.status).toBe(400)
    expect(prismaMock.purchaseRequest.findMany).not.toHaveBeenCalled()
  })
})
