import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db')

const { mockAuthClient, mockAuthFn, mockScopeFn, mockCreateTask } = vi.hoisted(() => {
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
  }
})

vi.mock('@/lib/api-auth', () => ({
  authenticateApiClient: mockAuthFn,
  requireScope: mockScopeFn,
}))

vi.mock('@/lib/work-engine', () => ({
  createTask: mockCreateTask,
}))

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
})
