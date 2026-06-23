import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db')

const { mockAuthClient, mockAuthFn, mockScopeFn, mockCreateTask, mockSaveAttachment } = vi.hoisted(() => {
  const mockAuthClient = {
    id: 'client-1', name: 'Sale', keyPrefix: 'ibsk_live_xxxxxxxx', keyHash: 'h',
    webhookSecret: 's', callbackUrl: null, scopes: ['read:projects', 'read:tasks', 'write:tasks'],
    active: true, lastUsedAt: null, createdAt: new Date(),
  }
  return {
    mockAuthClient,
    mockAuthFn: vi.fn().mockResolvedValue(mockAuthClient),
    mockScopeFn: vi.fn((client: typeof mockAuthClient, scope: string) => client.scopes.includes(scope)),
    mockCreateTask: vi.fn().mockResolvedValue({ id: 'task-1', status: 'OPEN', createdAt: new Date() }),
    mockSaveAttachment: vi.fn().mockResolvedValue({ id: 'att-1', fileName: 'test.pdf', fileUrl: '/uploads/taskdoc/task-1_doc0/test.pdf' }),
  }
})

vi.mock('@/lib/api-auth', () => ({
  authenticateApiClient: mockAuthFn,
  requireScope: mockScopeFn,
}))

vi.mock('@/lib/work-engine', () => ({
  createTask: mockCreateTask,
}))

vi.mock('@/lib/save-attachment', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>
  return { ...original, saveAttachmentFromBuffer: mockSaveAttachment }
})

import { prismaMock } from '@/lib/__mocks__/db'
import { POST } from '@/app/api/external/v1/tasks/route'
import { NextRequest } from 'next/server'

function makeReq(body: unknown) {
  return new NextRequest('http://localhost/api/external/v1/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ibsk_live_test' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/external/v1/tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthFn.mockResolvedValue(mockAuthClient)
    prismaMock.task.findUnique.mockResolvedValue(null)
    prismaMock.project.findFirst.mockResolvedValue({ id: 'proj-1', projectCode: 'TST-001', projectName: 'Test' } as any)
    prismaMock.user.findUnique.mockResolvedValue({ id: 'sys', isActive: true, username: 'api-system' } as any)
    prismaMock.task.update.mockResolvedValue({} as any)
    mockCreateTask.mockResolvedValue({ id: 'task-1', status: 'OPEN', createdAt: new Date() })
  })

  it('creates task and returns 201', async () => {
    const res = await POST(makeReq({
      externalRef: 'SALE-001', projectCode: 'TST-001', title: 'Test task', assignee: { role: 'R02' },
    }))
    const json = await res.json()
    expect(res.status).toBe(201)
    expect(json.ok).toBe(true)
    expect(json.data.taskId).toBe('task-1')
    expect(json.data.externalRef).toBe('SALE-001')
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      expect.objectContaining({ externalRef: 'SALE-001', externalSource: 'sale', externalClientId: 'client-1' }),
    )
  })

  it('handles P2002 race (concurrent POST same externalRef)', async () => {
    mockCreateTask.mockRejectedValue({ code: 'P2002' })
    prismaMock.task.findUnique.mockImplementation(async (args: any) => {
      if (args.where?.externalRef === 'SALE-RACE') {
        return { id: 'task-raced', externalRef: 'SALE-RACE', status: 'OPEN', createdAt: new Date() } as any
      }
      if (args.where?.username === 'api-system') return { id: 'sys', isActive: true } as any
      return null
    })
    const res = await POST(makeReq({
      externalRef: 'SALE-RACE', projectCode: 'TST-001', title: 'Race test', assignee: { role: 'R02' },
    }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.data.taskId).toBe('task-raced')
  })

  it('returns 200 for duplicate externalRef (idempotent)', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: 'task-existing', externalRef: 'SALE-001', status: 'IN_PROGRESS', createdAt: new Date(),
    } as any)

    const res = await POST(makeReq({
      externalRef: 'SALE-001', projectCode: 'TST-001', title: 'Test task', assignee: { role: 'R02' },
    }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.data.taskId).toBe('task-existing')
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('returns 404 for unknown projectCode', async () => {
    prismaMock.project.findFirst.mockResolvedValue(null)
    const res = await POST(makeReq({
      externalRef: 'SALE-002', projectCode: 'NONEXIST', title: 'Test', assignee: { role: 'R02' },
    }))
    expect(res.status).toBe(404)
  })

  it('returns 400 for inactive userId', async () => {
    prismaMock.user.findUnique.mockImplementation(async (args: any) => {
      if (args.where?.id === 'inactive-user') return { id: 'inactive-user', isActive: false } as any
      if (args.where?.username === 'api-system') return { id: 'sys', isActive: true } as any
      return null
    })
    const res = await POST(makeReq({
      externalRef: 'SALE-003', projectCode: 'TST-001', title: 'Test', assignee: { userId: 'inactive-user' },
    }))
    expect(res.status).toBe(400)
  })

  it('returns 404 for unknown email', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null)
    const res = await POST(makeReq({
      externalRef: 'SALE-004', projectCode: 'TST-001', title: 'Test', assignee: { email: 'nobody@x.com' },
    }))
    expect(res.status).toBe(404)
  })

  it('returns 400 for missing required fields', async () => {
    const res = await POST(makeReq({ title: 'No ref' }))
    expect(res.status).toBe(400)
  })

  // ── Attachment tests ──

  const validBase64 = Buffer.from('Hello PDF content').toString('base64')

  it('creates task with 1 attachment → MUST_READ doc', async () => {
    prismaMock.taskDocRequirement.create.mockResolvedValue({ id: 'doc-1' } as any)

    const res = await POST(makeReq({
      externalRef: 'SALE-ATT-1', projectCode: 'TST-001', title: 'With file',
      assignee: { role: 'R02' },
      attachments: [{ fileName: 'spec.pdf', contentBase64: validBase64 }],
    }))
    const json = await res.json()
    expect(res.status).toBe(201)
    expect(json.ok).toBe(true)
    expect(mockSaveAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'spec.pdf',
        entityType: 'TaskDoc',
        entityId: expect.stringContaining('_doc0'),
      }),
    )
    expect(prismaMock.taskDocRequirement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'MUST_READ',
        label: 'spec.pdf',
        fileAttachmentId: 'att-1',
      }),
    })
  })

  it('rejects .svg file → 400, no task created', async () => {
    const res = await POST(makeReq({
      externalRef: 'SALE-ATT-SVG', projectCode: 'TST-001', title: 'SVG bad',
      assignee: { role: 'R02' },
      attachments: [{ fileName: 'evil.svg', contentBase64: validBase64 }],
    }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('.svg')
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('rejects file >20MB → 400', async () => {
    const bigBase64 = Buffer.alloc(21 * 1024 * 1024).toString('base64')
    const res = await POST(makeReq({
      externalRef: 'SALE-ATT-BIG', projectCode: 'TST-001', title: 'Big file',
      assignee: { role: 'R02' },
      attachments: [{ fileName: 'huge.pdf', contentBase64: bigBase64 }],
    }))
    expect(res.status).toBe(400)
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('idempotent POST does NOT re-create attachments', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: 'task-existing', externalRef: 'SALE-ATT-IDEM', status: 'OPEN', createdAt: new Date(),
    } as any)

    const res = await POST(makeReq({
      externalRef: 'SALE-ATT-IDEM', projectCode: 'TST-001', title: 'Dup',
      assignee: { role: 'R02' },
      attachments: [{ fileName: 'dup.pdf', contentBase64: validBase64 }],
    }))
    expect(res.status).toBe(200)
    expect(mockSaveAttachment).not.toHaveBeenCalled()
    expect(prismaMock.taskDocRequirement.create).not.toHaveBeenCalled()
  })

  it('rejects >10 attachments → 400', async () => {
    const att = { fileName: 'f.pdf', contentBase64: validBase64 }
    const res = await POST(makeReq({
      externalRef: 'SALE-ATT-MANY', projectCode: 'TST-001', title: 'Too many',
      assignee: { role: 'R02' },
      attachments: Array(11).fill(att),
    }))
    expect(res.status).toBe(400)
    expect(mockCreateTask).not.toHaveBeenCalled()
  })
})
