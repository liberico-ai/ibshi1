/**
 * #V2-wiring: PUT /api/design/bom/versions/[id] { status: 'ACTIVE' }
 * phải đi qua approveRevision (revision-flow) — KHÔNG tự supersede/activate/cascade nữa.
 * - ACTIVE → approveRevision(id, user.userId) được gọi, response giữ shape cũ (version + message)
 * - approveRevision ném "chỉ DRAFT mới duyệt được" (vd SUPERSEDED) → 422
 * - approveRevision ném "cần APPROVED" (ECO chưa duyệt) → 422
 * - approveRevision ném "BomVersion không tồn tại" → 404
 * - Các nhánh status khác (DRAFT/SUPERSEDED/field update) không gọi approveRevision
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

const mockApproveRevision = vi.fn()
vi.mock('@/lib/revision-flow', () => ({
  approveRevision: (...args: unknown[]) => mockApproveRevision(...args),
}))

import { PUT as versionPUT } from '@/app/api/design/bom/versions/[id]/route'
import { authenticateRequest } from '@/lib/auth'

const jsonReq = (body: unknown) =>
  new Request('http://localhost/api/design/bom/versions/bv-1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const ctx = { params: Promise.resolve({ id: 'bv-1' }) }

const existingVersion = { id: 'bv-1', bomId: 'bom-1', status: 'DRAFT', versionNo: 2 }
const refetchedVersion = {
  ...existingVersion,
  status: 'ACTIVE',
  lines: [],
  bom: { id: 'bom-1', bomCode: 'BOM-01', name: 'BOM Test', projectId: 'proj-1' },
  sourceRevision: null,
  eco: { id: 'eco-1', ecoCode: 'ECO-26-001', status: 'APPROVED' },
}

describe('PUT /api/design/bom/versions/[id] — wiring approveRevision (#V2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(mockUser as never)
  })

  it('status ACTIVE → gọi approveRevision(id, user.userId), giữ shape response cũ', async () => {
    prismaMock.bomVersion.findUnique
      .mockResolvedValueOnce(existingVersion as never)   // check existing
      .mockResolvedValueOnce(refetchedVersion as never)  // refetch sau approve
    mockApproveRevision.mockResolvedValue({ id: 'bv-1', status: 'ACTIVE' })

    const res = await versionPUT(jsonReq({ status: 'ACTIVE' }) as never, ctx)

    expect(res.status).toBe(200)
    expect(mockApproveRevision).toHaveBeenCalledTimes(1)
    expect(mockApproveRevision).toHaveBeenCalledWith('bv-1', 'user-1')

    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.message).toBe('Đã kích hoạt phiên bản BOM')
    expect(json.version).toMatchObject({ id: 'bv-1', status: 'ACTIVE' })
    expect(json.version.bom.projectId).toBe('proj-1')

    // Route KHÔNG được tự supersede/activate nữa (đã chuyển vào approveRevision)
    expect(prismaMock.bomVersion.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('version SUPERSEDED (chỉ DRAFT mới duyệt được) → 422', async () => {
    prismaMock.bomVersion.findUnique.mockResolvedValue({ ...existingVersion, status: 'SUPERSEDED' } as never)
    mockApproveRevision.mockRejectedValue(
      new Error('BomVersion đang ở trạng thái "SUPERSEDED", chỉ DRAFT mới duyệt được')
    )

    const res = await versionPUT(jsonReq({ status: 'ACTIVE' }) as never, ctx)

    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.error).toContain('chỉ DRAFT mới duyệt được')
    expect(prismaMock.bomVersion.update).not.toHaveBeenCalled()
  })

  it('ECO chưa APPROVED → 422', async () => {
    prismaMock.bomVersion.findUnique.mockResolvedValue(existingVersion as never)
    mockApproveRevision.mockRejectedValue(
      new Error('ECO "ECO-26-001" đang ở trạng thái "DRAFT" — cần APPROVED trước khi duyệt BOM version')
    )

    const res = await versionPUT(jsonReq({ status: 'ACTIVE' }) as never, ctx)

    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toContain('cần APPROVED')
  })

  it('approveRevision báo BomVersion không tồn tại → 404', async () => {
    prismaMock.bomVersion.findUnique.mockResolvedValue(existingVersion as never)
    mockApproveRevision.mockRejectedValue(new Error('BomVersion không tồn tại'))

    const res = await versionPUT(jsonReq({ status: 'ACTIVE' }) as never, ctx)

    expect(res.status).toBe(404)
  })

  it('lỗi khác từ approveRevision → 400', async () => {
    prismaMock.bomVersion.findUnique.mockResolvedValue(existingVersion as never)
    mockApproveRevision.mockRejectedValue(new Error('ECO liên kết không tồn tại'))

    const res = await versionPUT(jsonReq({ status: 'ACTIVE' }) as never, ctx)

    expect(res.status).toBe(400)
  })

  it('status khác (DRAFT) → KHÔNG gọi approveRevision, update trực tiếp như cũ', async () => {
    prismaMock.bomVersion.findUnique.mockResolvedValue({ ...existingVersion, status: 'SUPERSEDED' } as never)
    prismaMock.bomVersion.update.mockResolvedValue({ ...refetchedVersion, status: 'DRAFT' } as never)

    const res = await versionPUT(jsonReq({ status: 'DRAFT' }) as never, ctx)

    expect(res.status).toBe(200)
    expect(mockApproveRevision).not.toHaveBeenCalled()
    expect(prismaMock.bomVersion.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'bv-1' }, data: expect.objectContaining({ status: 'DRAFT' }) })
    )
  })

  it('role không có quyền (R05) → 403, không gọi approveRevision', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ...mockUser, roleCode: 'R05' } as never)

    const res = await versionPUT(jsonReq({ status: 'ACTIVE' }) as never, ctx)

    expect(res.status).toBe(403)
    expect(mockApproveRevision).not.toHaveBeenCalled()
  })
})
