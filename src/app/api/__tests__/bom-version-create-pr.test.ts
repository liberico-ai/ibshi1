/**
 * Tests cho POST /api/design/bom/versions/[id]/create-pr (Đợt2-A — ECO auto-apply)
 *
 * - Tạo đúng items từ impact mock: chỉ dòng mua (ADD_PR/UPDATE_PR) và qtyDelta > 0
 * - Idempotent: đã có PR originType=ECO originId=<versionId> → trả PR cũ (existing:true), không tạo trùng
 * - Version không ACTIVE / không gắn ECO → 422
 * - Không có baseline SUPERSEDED → 422
 * - 0 dòng cần mua → 200 created:false, không tạo PR rỗng
 * - Sai role (ngoài PR_EDIT_ROLES) → 403
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prismaMock } from '@/lib/__mocks__/db'
import type { ImpactLine, ImpactResult, DiffLine } from '@/lib/bom-diff-engine'

const { mockAuthUser } = vi.hoisted(() => ({
  mockAuthUser: {
    userId: 'user-1',
    roleCode: 'R02', // PM — thuộc PR_EDIT_ROLES
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

const mockComputeImpact = vi.fn()
vi.mock('@/lib/bom-diff-engine', () => ({
  computeImpact: (...args: unknown[]) => mockComputeImpact(...args),
}))

import { POST as createPr } from '@/app/api/design/bom/versions/[id]/create-pr/route'
import { authenticateRequest } from '@/lib/auth'

// ── Helpers ──

const VERSION_ID = 'ver-new'
const YEAR = new Date().getFullYear().toString().slice(-2)

function req() {
  return new NextRequest(`http://localhost/api/design/bom/versions/${VERSION_ID}/create-pr`, {
    method: 'POST',
  })
}

function callRoute(id = VERSION_ID) {
  return createPr(req(), { params: Promise.resolve({ id }) })
}

const activeEcoVersion = {
  id: VERSION_ID,
  bomId: 'bom-1',
  versionNo: 3,
  status: 'ACTIVE',
  ecoId: 'eco-1',
  bom: { id: 'bom-1', projectId: 'proj-1' },
  eco: { id: 'eco-1', ecoCode: 'ECO-26-001' },
}

const baselineVersion = { id: 'ver-old', versionNo: 2 }

function makeDiffLine(overrides: Partial<DiffLine> = {}): DiffLine {
  return {
    action: 'QTY_CHANGED',
    category: 'MAIN',
    materialId: 'mat-1',
    materialCode: 'VTC-001',
    materialName: 'Thép tấm SS400',
    pieceMark: 'PM-101',
    profile: 'H300x150',
    grade: 'SS400',
    unit: 'kg',
    qtyOld: 100,
    qtyNew: 120,
    qtyDelta: 20,
    oldLineId: 'old-1',
    newLineId: 'new-1',
    ...overrides,
  }
}

function makeImpactLine(
  diffOverrides: Partial<DiffLine> = {},
  impactOverrides: Partial<ImpactLine> = {},
): ImpactLine {
  return {
    diffLine: makeDiffLine(diffOverrides),
    procurementStatus: 'NOT_PURCHASED',
    currentPrQty: 0,
    currentPoQty: 0,
    currentStockQty: 0,
    suggestedAction: 'Tạo PR bổ sung',
    suggestedActionCode: 'ADD_PR',
    ...impactOverrides,
  }
}

function makeImpact(lines: ImpactLine[]): ImpactResult {
  return {
    versionId: VERSION_ID,
    projectId: 'proj-1',
    lines,
    summary: {
      totalChanges: lines.length,
      needPurchase: lines.filter(l => ['ADD_PR', 'UPDATE_PR'].includes(l.suggestedActionCode)).length,
      canUseStock: lines.filter(l => l.suggestedActionCode === 'USE_STOCK').length,
      needPOAlert: lines.filter(l => l.suggestedActionCode === 'ALERT_PO').length,
      needNCR: lines.filter(l => l.suggestedActionCode === 'NCR').length,
    },
  }
}

/** purchaseRequest.findFirst được gọi 2 lần: (1) idempotency theo origin, (2) sinh prCode */
function mockPrFindFirst({ existingOriginPr = null, lastPr = null }: {
  existingOriginPr?: Record<string, unknown> | null
  lastPr?: Record<string, unknown> | null
} = {}) {
  prismaMock.purchaseRequest.findFirst.mockImplementation(((args: { where?: Record<string, unknown> }) => {
    if (args?.where?.originType === 'ECO') return Promise.resolve(existingOriginPr)
    return Promise.resolve(lastPr) // prCode { startsWith }
  }) as never)
}

function mockCreateEcho() {
  prismaMock.purchaseRequest.create.mockImplementation((async (args: { data: Record<string, unknown> }) => ({
    id: 'pr-auto-1',
    ...args.data,
    items: [],
    project: { projectCode: 'PRJ-01', projectName: 'Du an 1' },
  })) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateRequest).mockResolvedValue(mockAuthUser as never)
  prismaMock.bomVersion.findUnique.mockResolvedValue(activeEcoVersion as never)
  prismaMock.bomVersion.findFirst.mockResolvedValue(baselineVersion as never)
  mockPrFindFirst()
  mockCreateEcho()
})

// ── Tests ──

describe('POST /api/design/bom/versions/[id]/create-pr — ECO auto-apply', () => {
  it('tạo PR với đúng items: chỉ dòng ADD_PR/UPDATE_PR có qtyDelta > 0', async () => {
    mockComputeImpact.mockResolvedValue(makeImpact([
      makeImpactLine({ materialId: 'mat-1', qtyDelta: 20 }, { suggestedActionCode: 'ADD_PR' }),
      makeImpactLine({ materialId: 'mat-2', qtyDelta: 5 }, { suggestedActionCode: 'UPDATE_PR', suggestedAction: 'Tăng SL trên PR hiện tại' }),
      makeImpactLine({ materialId: 'mat-3', qtyDelta: 10 }, { suggestedActionCode: 'USE_STOCK' }), // dùng tồn — loại
      makeImpactLine({ materialId: 'mat-4', qtyDelta: -8, action: 'REMOVED' }, { suggestedActionCode: 'NONE' }), // giảm — loại
      makeImpactLine({ materialId: 'mat-5', qtyDelta: 30 }, { suggestedActionCode: 'ALERT_PO', procurementStatus: 'IN_PO', currentPoQty: 100 }), // đã PO — chỉ cảnh báo
    ]))

    const res = await callRoute()
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.created).toBe(true)
    expect(json.prCode).toBe(`PR-${YEAR}-001`)

    // computeImpact gọi với baseline tường minh
    expect(mockComputeImpact).toHaveBeenCalledWith(VERSION_ID, 'ver-old')

    const createCall = prismaMock.purchaseRequest.create.mock.calls[0][0] as {
      data: Record<string, unknown> & { items: { create: Array<{ materialId: string; quantity: number }> } }
    }
    expect(createCall.data).toMatchObject({
      projectId: 'proj-1',
      requestedBy: 'user-1',
      status: 'DRAFT',
      originType: 'ECO',
      originId: VERSION_ID, // originId = bomVersionId — nhất quán cascade-tasks
      originLabel: 'ECO-26-001',
    })
    // Chỉ 2 dòng mua, quantity = qtyDelta
    expect(createCall.data.items.create).toHaveLength(2)
    expect(createCall.data.items.create).toEqual(expect.arrayContaining([
      expect.objectContaining({ materialId: 'mat-1', quantity: 20 }),
      expect.objectContaining({ materialId: 'mat-2', quantity: 5 }),
    ]))

    // poAlerts trả về dòng ALERT_PO — không đụng PO
    expect(json.poAlerts).toHaveLength(1)
    expect(json.poAlerts[0]).toMatchObject({ materialId: 'mat-5', currentPoQty: 100 })
    expect(json.items).toHaveLength(2)
  })

  it('idempotent: đã có PR origin ECO + versionId → trả PR cũ existing:true, không tạo trùng', async () => {
    mockPrFindFirst({
      existingOriginPr: {
        id: 'pr-old-1',
        prCode: `PR-${YEAR}-007`,
        originType: 'ECO',
        originId: VERSION_ID,
        originLabel: 'ECO-26-001',
        items: [],
        project: { projectCode: 'PRJ-01', projectName: 'Du an 1' },
      },
    })

    const res = await callRoute()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.existing).toBe(true)
    expect(json.created).toBe(false)
    expect(json.prCode).toBe(`PR-${YEAR}-007`)
    expect(prismaMock.purchaseRequest.create).not.toHaveBeenCalled()
    expect(mockComputeImpact).not.toHaveBeenCalled()
  })

  it('version không tồn tại → 404', async () => {
    prismaMock.bomVersion.findUnique.mockResolvedValue(null)
    const res = await callRoute('ver-missing')
    expect(res.status).toBe(404)
    expect(prismaMock.purchaseRequest.create).not.toHaveBeenCalled()
  })

  it('version chưa ACTIVE (DRAFT) → 422', async () => {
    prismaMock.bomVersion.findUnique.mockResolvedValue({ ...activeEcoVersion, status: 'DRAFT' } as never)
    const res = await callRoute()
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(prismaMock.purchaseRequest.create).not.toHaveBeenCalled()
  })

  it('version ACTIVE nhưng không gắn ECO → 422', async () => {
    prismaMock.bomVersion.findUnique.mockResolvedValue({ ...activeEcoVersion, ecoId: null, eco: null } as never)
    const res = await callRoute()
    expect(res.status).toBe(422)
    expect(prismaMock.purchaseRequest.create).not.toHaveBeenCalled()
  })

  it('không có bản SUPERSEDED trước để so → 422', async () => {
    prismaMock.bomVersion.findFirst.mockResolvedValue(null)
    const res = await callRoute()
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toContain('bản trước')
    expect(mockComputeImpact).not.toHaveBeenCalled()
    expect(prismaMock.purchaseRequest.create).not.toHaveBeenCalled()
  })

  it('0 dòng cần mua → 200 created:false, không tạo PR rỗng (vẫn trả poAlerts)', async () => {
    mockComputeImpact.mockResolvedValue(makeImpact([
      makeImpactLine({ materialId: 'mat-3', qtyDelta: 10 }, { suggestedActionCode: 'USE_STOCK' }),
      makeImpactLine({ materialId: 'mat-5', qtyDelta: 30 }, { suggestedActionCode: 'ALERT_PO', currentPoQty: 100 }),
    ]))

    const res = await callRoute()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.created).toBe(false)
    expect(json.existing).toBe(false)
    expect(json.message).toBeTruthy()
    expect(json.poAlerts).toHaveLength(1)
    expect(prismaMock.purchaseRequest.create).not.toHaveBeenCalled()
  })

  it('role ngoài PR_EDIT_ROLES (R06) → 403', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ...mockAuthUser, roleCode: 'R06' } as never)
    const res = await callRoute()
    expect(res.status).toBe(403)
    expect(prismaMock.bomVersion.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.purchaseRequest.create).not.toHaveBeenCalled()
  })
})
