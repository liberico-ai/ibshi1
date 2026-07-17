/**
 * Tests cho POST /api/design/bom/[id]/create-revision (Finding A — revision LUÔN kèm ECO)
 *
 * - Happy path: gọi createRevisionWithEco với đúng params (bomId từ path, projectId THẬT từ BOM,
 *   userId từ auth) → 201, trả drawingRevision/eco/bomVersion.
 * - Sai role (ngoài R01/R04/R04a/R02) → 403, KHÔNG chạm createRevisionWithEco.
 * - BOM không tồn tại → 404.
 * - Drawing khác dự án với BOM → 422.
 * - revCode trùng trên drawing → 422.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { prismaMock } from '@/lib/__mocks__/db'

const { mockAuthUser } = vi.hoisted(() => ({
  mockAuthUser: {
    userId: 'user-1',
    roleCode: 'R04', // Thiết kế — thuộc bộ role được tạo revision
    username: 'designer',
    userLevel: 1,
    fullName: 'Designer',
  },
}))

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return {
    ...actual,
    authenticateRequest: vi.fn().mockResolvedValue(mockAuthUser),
  }
})

const mockCreateRevisionWithEco = vi.fn()
vi.mock('@/lib/revision-flow', () => ({
  createRevisionWithEco: (...args: unknown[]) => mockCreateRevisionWithEco(...args),
}))

import { POST as createRevision } from '@/app/api/design/bom/[id]/create-revision/route'
import { authenticateRequest } from '@/lib/auth'

// ── Helpers ──

const BOM_ID = 'bom-1'

const validBody = {
  drawingId: 'dwg-1',
  revCode: 'R1',
  description: 'Đổi quy cách dầm chính',
  ecoTitle: 'ECO đổi dầm',
  ecoDescription: 'Đổi H300 → H350',
  changeType: 'DESIGN',
}

function req(body: Record<string, unknown> = validBody) {
  return new NextRequest(`http://localhost/api/design/bom/${BOM_ID}/create-revision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function callRoute(id = BOM_ID, body: Record<string, unknown> = validBody) {
  return createRevision(req(body), { params: Promise.resolve({ id }) })
}

const createdResult = {
  drawingRevision: { id: 'rev-1', revision: 'R1' },
  eco: { id: 'eco-1', ecoCode: 'ECO-26-001' },
  bomVersion: { id: 'ver-1', versionNo: 2 },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateRequest).mockResolvedValue(mockAuthUser as never)
  prismaMock.billOfMaterial.findUnique.mockResolvedValue({ id: BOM_ID, projectId: 'proj-1' } as never)
  prismaMock.drawing.findUnique.mockResolvedValue({ id: 'dwg-1', projectId: 'proj-1' } as never)
  prismaMock.drawingRevision.findFirst.mockResolvedValue(null)
  mockCreateRevisionWithEco.mockResolvedValue(createdResult)
})

// ── Tests ──

describe('POST /api/design/bom/[id]/create-revision — Finding A', () => {
  it('happy path: gọi createRevisionWithEco với params đúng → 201', async () => {
    const res = await callRoute()
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.bomVersion).toMatchObject({ id: 'ver-1', versionNo: 2 })
    expect(json.eco).toMatchObject({ ecoCode: 'ECO-26-001' })

    expect(mockCreateRevisionWithEco).toHaveBeenCalledTimes(1)
    expect(mockCreateRevisionWithEco).toHaveBeenCalledWith({
      drawingId: 'dwg-1',
      revCode: 'R1',
      description: 'Đổi quy cách dầm chính',
      bomId: BOM_ID,
      ecoTitle: 'ECO đổi dầm',
      ecoDescription: 'Đổi H300 → H350',
      changeType: 'DESIGN',
      userId: 'user-1',
      projectId: 'proj-1', // projectId THẬT từ BOM, không nhận từ client
    })
  })

  it('sai role (R06) → 403, không chạm createRevisionWithEco', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ...mockAuthUser, roleCode: 'R06' } as never)
    const res = await callRoute()
    expect(res.status).toBe(403)
    expect(mockCreateRevisionWithEco).not.toHaveBeenCalled()
    expect(prismaMock.billOfMaterial.findUnique).not.toHaveBeenCalled()
  })

  it('BOM không tồn tại → 404', async () => {
    prismaMock.billOfMaterial.findUnique.mockResolvedValue(null)
    const res = await callRoute()
    expect(res.status).toBe(404)
    expect(mockCreateRevisionWithEco).not.toHaveBeenCalled()
  })

  it('drawing khác dự án với BOM → 422', async () => {
    prismaMock.drawing.findUnique.mockResolvedValue({ id: 'dwg-1', projectId: 'proj-OTHER' } as never)
    const res = await callRoute()
    expect(res.status).toBe(422)
    expect(mockCreateRevisionWithEco).not.toHaveBeenCalled()
  })

  it('revCode trùng trên drawing → 422', async () => {
    prismaMock.drawingRevision.findFirst.mockResolvedValue({ id: 'rev-existing' } as never)
    const res = await callRoute()
    expect(res.status).toBe(422)
    expect(mockCreateRevisionWithEco).not.toHaveBeenCalled()
  })

  // LOW#3 race: TOCTOU revCode (unique [drawingId,revision]) hoặc ecoCode (count()+1 đụng) khi 2 thao tác
  // đồng thời → createRevisionWithEco ném Prisma P2002 → route trả 422 (retryable), KHÔNG 500. Tx đã rollback.
  it('createRevisionWithEco ném P2002 (race revCode/ecoCode) → 422, không 500', async () => {
    mockCreateRevisionWithEco.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'x' }),
    )
    const res = await callRoute()
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  it('createRevisionWithEco ném lỗi KHÁC (không P2002) → vẫn 500 (không nuốt nhầm thành 422)', async () => {
    mockCreateRevisionWithEco.mockRejectedValue(new Error('DB down'))
    const res = await callRoute()
    expect(res.status).toBe(500)
  })
})
