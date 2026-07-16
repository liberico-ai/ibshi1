/**
 * Route tests for T5 — Sổ tài liệu dự án (Project Document Register).
 * GET (list + filter) / POST (create). Prisma deep-mocked; auth mocked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { prismaMock } from '@/lib/__mocks__/db'

const mockAuth = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>()
  return {
    ...actual,
    authenticateRequest: (...a: unknown[]) => mockAuth(...a),
    // R01 sees all projects → getUserProjectIds returns null (no filter)
    getUserProjectIds: vi.fn().mockResolvedValue(null),
    logAudit: vi.fn().mockResolvedValue(undefined),
  }
})

import { GET, POST } from '@/app/api/projects/[id]/documents/route'

const PM = { userId: 'u1', username: 'pm', roleCode: 'R02', userLevel: 2, fullName: 'PM' }
const PROJECT_ID = 'proj_1'
const params = Promise.resolve({ id: PROJECT_ID })

function postReq(payload: unknown) {
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/documents`, {
    method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  mockAuth.mockResolvedValue(PM)
  prismaMock.project.findUnique.mockResolvedValue({ id: PROJECT_ID, projectCode: 'I-095', projectName: 'VPI' } as never)
})

// ── GET list ──
describe('GET /api/projects/[id]/documents', () => {
  it('trả danh sách + đính kèm metadata file', async () => {
    prismaMock.projectDocument.findMany.mockResolvedValue([
      { id: 'd1', docCode: 'BV-001', docType: 'BAN_VE', revision: 'Rev0', deptCode: 'R04', title: 'Bản vẽ KC', fileAttachmentId: 'att1', taskId: null, status: 'ACTIVE', uploadedBy: 'u1', createdAt: new Date(), projectId: PROJECT_ID, updatedAt: new Date() },
    ] as never)
    prismaMock.fileAttachment.findMany.mockResolvedValue([
      { id: 'att1', fileName: 'kc.pdf', fileUrl: '/uploads/projectdoc/x/kc.pdf', mimeType: 'application/pdf' },
    ] as never)

    const res = await GET(new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/documents`), { params })
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.documents).toHaveLength(1)
    expect(body.documents[0].file.fileName).toBe('kc.pdf')
    expect(body.canCreate).toBe(true)
  })

  it('lọc theo docType + deptCode đi vào where', async () => {
    prismaMock.projectDocument.findMany.mockResolvedValue([] as never)
    await GET(new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/documents?docType=QC&deptCode=R09`), { params })
    expect(prismaMock.projectDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: PROJECT_ID, docType: 'QC', deptCode: 'R09' } }),
    )
  })

  it('401 khi chưa đăng nhập', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/documents`), { params })
    expect(res.status).toBe(401)
  })

  it('404 khi dự án không tồn tại', async () => {
    prismaMock.project.findUnique.mockResolvedValue(null as never)
    const res = await GET(new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/documents`), { params })
    expect(res.status).toBe(404)
  })
})

// ── POST create ──
describe('POST /api/projects/[id]/documents', () => {
  it('tạo bản ghi hợp lệ', async () => {
    prismaMock.projectDocument.create.mockResolvedValue({ id: 'd1', docCode: 'BV-001' } as never)
    const res = await POST(postReq({ docCode: 'BV-001', docType: 'BAN_VE', title: 'Bản vẽ KC' }), { params })
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.ok).toBe(true)
    expect(prismaMock.projectDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ projectId: PROJECT_ID, docCode: 'BV-001', docType: 'BAN_VE', revision: 'Rev0', uploadedBy: 'u1' }),
      }),
    )
  })

  it('403 khi role không được phép tạo (R05 Kho)', async () => {
    mockAuth.mockResolvedValue({ ...PM, roleCode: 'R05' })
    const res = await POST(postReq({ docCode: 'X', docType: 'BAN_VE', title: 'x' }), { params })
    expect(res.status).toBe(403)
    expect(prismaMock.projectDocument.create).not.toHaveBeenCalled()
  })

  it('400 khi thiếu docCode', async () => {
    const res = await POST(postReq({ docType: 'BAN_VE', title: 'x' }), { params })
    expect(res.status).toBe(400)
  })

  it('400 khi docType không hợp lệ', async () => {
    const res = await POST(postReq({ docCode: 'X', docType: 'INVALID', title: 'x' }), { params })
    expect(res.status).toBe(400)
    expect(prismaMock.projectDocument.create).not.toHaveBeenCalled()
  })

  it('400 khi fileAttachmentId không tồn tại', async () => {
    prismaMock.fileAttachment.findUnique.mockResolvedValue(null as never)
    const res = await POST(postReq({ docCode: 'X', docType: 'BAN_VE', title: 'x', fileAttachmentId: 'nope' }), { params })
    expect(res.status).toBe(400)
    expect(prismaMock.projectDocument.create).not.toHaveBeenCalled()
  })

  it('400 khi taskId không thuộc dự án', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 't1', projectId: 'other' } as never)
    const res = await POST(postReq({ docCode: 'X', docType: 'BAN_VE', title: 'x', taskId: 't1' }), { params })
    expect(res.status).toBe(400)
    expect(prismaMock.projectDocument.create).not.toHaveBeenCalled()
  })
})
