/**
 * #V2-wiring: API lines cho BomVersion (DRAFT-only)
 * PUT /api/design/bom/versions/[id]/lines — REPLACE toàn bộ lines:
 * - DRAFT → deleteMany theo bomVersionId rồi createMany (đúng bomVersionId/bomId), trong $transaction
 * - version ACTIVE → 422 'Chỉ sửa được lines của version DRAFT'
 * - sai role (R05) → 403
 * - quantity ≤ 0 → 400 (Zod)
 * - materialId không tồn tại → 404
 * GET /api/design/bom/versions/[id]/lines — trả lines kèm material
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'

const { mockUser } = vi.hoisted(() => ({
  mockUser: {
    userId: 'user-1',
    roleCode: 'R04',
    username: 'design',
    userLevel: 2,
    fullName: 'Design User',
  },
}))

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return {
    ...actual,
    authenticateRequest: vi.fn().mockResolvedValue(mockUser),
  }
})

import { GET as linesGET, PUT as linesPUT } from '@/app/api/design/bom/versions/[id]/lines/route'
import { authenticateRequest } from '@/lib/auth'

const putReq = (body: unknown) =>
  new Request('http://localhost/api/design/bom/versions/bv-1/lines', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const getReq = () =>
  new Request('http://localhost/api/design/bom/versions/bv-1/lines', { method: 'GET' })

const ctx = { params: Promise.resolve({ id: 'bv-1' }) }

const draftVersion = { id: 'bv-1', bomId: 'bom-1', status: 'DRAFT', versionNo: 1 }

const validLines = [
  { materialId: 'mat-1', pieceMark: 'PM-001', quantity: 2, profile: 'H200x100', grade: 'SS400' },
  { materialId: 'mat-2', pieceMark: 'PM-002', category: 'WELD', quantity: 5, unit: 'kg' },
]

const createdLines = [
  {
    id: 'bi-1', bomId: 'bom-1', bomVersionId: 'bv-1', materialId: 'mat-1',
    pieceMark: 'PM-001', category: 'MAIN', quantity: 2, unit: 'cây', sortOrder: 0,
    material: { materialCode: 'THEP-H200', name: 'Thép H200', unit: 'cây' },
  },
  {
    id: 'bi-2', bomId: 'bom-1', bomVersionId: 'bv-1', materialId: 'mat-2',
    pieceMark: 'PM-002', category: 'WELD', quantity: 5, unit: 'kg', sortOrder: 1,
    material: { materialCode: 'QUE-HAN', name: 'Que hàn', unit: 'kg' },
  },
]

describe('PUT /api/design/bom/versions/[id]/lines — replace lines DRAFT-only (#V2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(mockUser as never)
    prismaMock.$transaction.mockImplementation(
      (async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock)) as never,
    )
  })

  it('version DRAFT → delete rồi create đúng bomVersionId/bomId, trả lines mới', async () => {
    prismaMock.bomVersion.findUnique.mockResolvedValue(draftVersion as never)
    prismaMock.material.findMany.mockResolvedValue([
      { id: 'mat-1', unit: 'cây' },
      { id: 'mat-2', unit: 'kg' },
    ] as never)
    prismaMock.bomItem.findMany.mockResolvedValue(createdLines as never)

    const res = await linesPUT(putReq({ lines: validLines }) as never, ctx)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.lines).toHaveLength(2)
    expect(json.message).toContain('2 dòng')

    // Replace trong transaction: deleteMany theo bomVersionId TRƯỚC createMany
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.bomItem.deleteMany).toHaveBeenCalledWith({ where: { bomVersionId: 'bv-1' } })
    const deleteOrder = prismaMock.bomItem.deleteMany.mock.invocationCallOrder[0]
    const createOrder = prismaMock.bomItem.createMany.mock.invocationCallOrder[0]
    expect(deleteOrder).toBeLessThan(createOrder)

    // createMany: đúng bomId/bomVersionId, sortOrder theo index, unit fallback từ material
    expect(prismaMock.bomItem.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          bomId: 'bom-1', bomVersionId: 'bv-1', materialId: 'mat-1',
          pieceMark: 'PM-001', category: 'MAIN', quantity: 2,
          unit: 'cây', profile: 'H200x100', grade: 'SS400', sortOrder: 0,
        }),
        expect.objectContaining({
          bomId: 'bom-1', bomVersionId: 'bv-1', materialId: 'mat-2',
          pieceMark: 'PM-002', category: 'WELD', quantity: 5, unit: 'kg', sortOrder: 1,
        }),
      ],
    })
  })

  it('lines rỗng → xóa hết, không createMany', async () => {
    prismaMock.bomVersion.findUnique.mockResolvedValue(draftVersion as never)
    prismaMock.bomItem.findMany.mockResolvedValue([] as never)

    const res = await linesPUT(putReq({ lines: [] }) as never, ctx)

    expect(res.status).toBe(200)
    expect(prismaMock.bomItem.deleteMany).toHaveBeenCalledWith({ where: { bomVersionId: 'bv-1' } })
    expect(prismaMock.bomItem.createMany).not.toHaveBeenCalled()
  })

  it('version ACTIVE → 422, không đụng dữ liệu', async () => {
    prismaMock.bomVersion.findUnique.mockResolvedValue({ ...draftVersion, status: 'ACTIVE' } as never)
    prismaMock.material.findMany.mockResolvedValue([
      { id: 'mat-1', unit: 'cây' },
      { id: 'mat-2', unit: 'kg' },
    ] as never)

    const res = await linesPUT(putReq({ lines: validLines }) as never, ctx)

    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.error).toBe('Chỉ sửa được lines của version DRAFT')
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.bomItem.deleteMany).not.toHaveBeenCalled()
  })

  it('sai role (R05) → 403', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ...mockUser, roleCode: 'R05' } as never)

    const res = await linesPUT(putReq({ lines: validLines }) as never, ctx)

    expect(res.status).toBe(403)
    expect(prismaMock.bomVersion.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.bomItem.deleteMany).not.toHaveBeenCalled()
  })

  it('quantity ≤ 0 → 400 (Zod)', async () => {
    const res = await linesPUT(
      putReq({ lines: [{ materialId: 'mat-1', quantity: 0 }] }) as never,
      ctx,
    )

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('Số lượng phải > 0')
    expect(prismaMock.bomItem.deleteMany).not.toHaveBeenCalled()
  })

  it('materialId không tồn tại → 404, không replace', async () => {
    prismaMock.bomVersion.findUnique.mockResolvedValue(draftVersion as never)
    prismaMock.material.findMany.mockResolvedValue([{ id: 'mat-1', unit: 'cây' }] as never)

    const res = await linesPUT(putReq({ lines: validLines }) as never, ctx)

    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toContain('mat-2')
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('version không tồn tại → 404', async () => {
    prismaMock.bomVersion.findUnique.mockResolvedValue(null as never)

    const res = await linesPUT(putReq({ lines: validLines }) as never, ctx)

    expect(res.status).toBe(404)
  })
})

describe('GET /api/design/bom/versions/[id]/lines', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(mockUser as never)
  })

  it('trả lines kèm material (mọi role đăng nhập, R05 vẫn xem được)', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ...mockUser, roleCode: 'R05' } as never)
    prismaMock.bomVersion.findUnique.mockResolvedValue({
      ...draftVersion,
      lines: createdLines,
    } as never)

    const res = await linesGET(getReq() as never, ctx)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.lines).toHaveLength(2)
    expect(json.lines[0].pieceMark).toBe('PM-001')
    expect(json.lines[0].material.materialCode).toBe('THEP-H200')
  })

  it('version không tồn tại → 404', async () => {
    prismaMock.bomVersion.findUnique.mockResolvedValue(null as never)

    const res = await linesGET(getReq() as never, ctx)

    expect(res.status).toBe(404)
  })
})
