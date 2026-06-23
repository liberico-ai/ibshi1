import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db')

const { mockAuthPayload, mockSetTaskStatusAdmin } = vi.hoisted(() => ({
  mockAuthPayload: { userId: 'pm1', roleCode: 'R02', fullName: 'PM User' },
  mockSetTaskStatusAdmin: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('@/lib/auth', () => ({
  authenticateRequest: vi.fn().mockResolvedValue(mockAuthPayload),
  successResponse: vi.fn((data: unknown) => new Response(JSON.stringify({ ok: true, ...data }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
  errorResponse: vi.fn((msg: string, status: number) => new Response(JSON.stringify({ ok: false, error: msg }), { status, headers: { 'Content-Type': 'application/json' } })),
  unauthorizedResponse: vi.fn(() => new Response(JSON.stringify({ ok: false }), { status: 401 })),
  forbiddenResponse: vi.fn(() => new Response(JSON.stringify({ ok: false }), { status: 403 })),
}))

vi.mock('@/lib/work-engine', () => ({
  setTaskStatusAdmin: mockSetTaskStatusAdmin,
}))

import { prismaMock } from '@/lib/__mocks__/db'
import { POST } from '@/app/api/work/briefing/import/route'
import { NextRequest } from 'next/server'

function makeApplyReq(rows: unknown[]) {
  return new NextRequest('http://localhost/api/work/briefing/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  })
}

describe('POST /briefing/import — apply inactive user filter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.project.findMany.mockResolvedValue([
      { id: 'proj1', projectCode: 'P001' },
    ] as any)
    prismaMock.task.findMany.mockResolvedValue([])
    ;(prismaMock.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation((fn: unknown) =>
      typeof fn === 'function' ? (fn as (tx: typeof prismaMock) => unknown)(prismaMock) : Promise.all(fn as unknown[]),
    )
    prismaMock.task.create.mockResolvedValue({ id: 'new-t1' } as any)
    prismaMock.taskAssignee.create.mockResolvedValue({} as any)
    prismaMock.taskHistory.create.mockResolvedValue({} as any)
  })

  it('filters out inactive users and adds warning', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'active1', isActive: true, fullName: 'Nguyễn Văn A' },
      { id: 'inactive1', isActive: false, fullName: 'Trần Văn B' },
    ] as any)

    const res = await POST(makeApplyReq([
      {
        include: true, action: 'create', title: 'Việc test',
        projectMode: 'existing', projectId: 'proj1',
        assigneeUserIds: ['active1', 'inactive1'],
        deadlineISO: '2026-07-01', status: '', criteria: '', proposal: '', decision: '', notes: '',
      },
    ]))

    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.created).toBe(1)
    expect(json.errors).toHaveLength(1)
    expect(json.errors[0].reason).toMatch(/vô hiệu/)
    expect(json.errors[0].reason).toContain('Trần Văn B')

    const createCall = prismaMock.taskAssignee.create.mock.calls
    const assignedUserIds = createCall.map(c => (c[0] as any).data.userId)
    expect(assignedUserIds).toContain('active1')
    expect(assignedUserIds).not.toContain('inactive1')
  })

  it('all inactive → falls back to creator', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'inactive1', isActive: false, fullName: 'Trần Văn B' },
    ] as any)

    const res = await POST(makeApplyReq([
      {
        include: true, action: 'create', title: 'Việc test 2',
        projectMode: 'existing', projectId: 'proj1',
        assigneeUserIds: ['inactive1'],
        deadlineISO: '2026-07-01', status: '', criteria: '', proposal: '', decision: '', notes: '',
      },
    ]))

    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.created).toBe(1)

    const createCall = prismaMock.taskAssignee.create.mock.calls
    const assignedUserIds = createCall.map(c => (c[0] as any).data.userId)
    expect(assignedUserIds).toContain('pm1')
    expect(assignedUserIds).not.toContain('inactive1')
  })
})

describe('POST /briefing/import — no auto-update by title', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.project.findMany.mockResolvedValue([
      { id: 'proj1', projectCode: 'P001' },
    ] as any)
    prismaMock.task.findMany.mockResolvedValue([])
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'u1', isActive: true, fullName: 'User A' },
    ] as any)
    ;(prismaMock.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation((fn: unknown) =>
      typeof fn === 'function' ? (fn as (tx: typeof prismaMock) => unknown)(prismaMock) : Promise.all(fn as unknown[]),
    )
    prismaMock.task.create.mockResolvedValue({ id: 'new-t' } as any)
    prismaMock.taskAssignee.create.mockResolvedValue({} as any)
    prismaMock.taskHistory.create.mockResolvedValue({} as any)
  })

  it('two rows same title → creates 2 tasks (no auto-dedup)', async () => {
    let createCount = 0
    prismaMock.task.create.mockImplementation(async () => {
      createCount++
      return { id: `task-${createCount}` } as any
    })

    const res = await POST(makeApplyReq([
      {
        include: true, action: 'create', title: 'Mua thép tấm',
        projectMode: 'existing', projectId: 'proj1',
        assigneeUserIds: ['u1'],
        deadlineISO: '2026-07-01', status: '', criteria: '', proposal: '', decision: '', notes: '',
      },
      {
        include: true, action: 'create', title: 'Mua thép tấm',
        projectMode: 'existing', projectId: 'proj1',
        assigneeUserIds: ['u1'],
        deadlineISO: '2026-07-15', status: '', criteria: '', proposal: '', decision: '', notes: '',
      },
    ]))

    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.created).toBe(2)
    expect(json.updated).toBe(0)
    expect(createCount).toBe(2)
  })

  it('PM chooses "update" for collision → updates that task', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: 'existing-1', resultData: { briefing: { criteria: 'old' } },
    } as any)
    prismaMock.task.update.mockResolvedValue({} as any)
    prismaMock.taskAssignee.deleteMany.mockResolvedValue({} as any)

    const res = await POST(makeApplyReq([
      {
        include: true, action: 'create', title: 'Mua thép tấm',
        resolveTo: 'update', collisionTaskId: 'existing-1',
        projectMode: 'existing', projectId: 'proj1',
        assigneeUserIds: ['u1'],
        deadlineISO: '2026-07-01', status: '', criteria: 'new criteria', proposal: '', decision: '', notes: '',
      },
    ]))

    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.updated).toBe(1)
    expect(json.created).toBe(0)
    expect(prismaMock.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'existing-1' } }),
    )
  })

  it('re-import with systemId (action=update + taskId) → updates by id', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 'sys-1', status: 'IN_PROGRESS' } as any)

    const res = await POST(makeApplyReq([
      {
        include: true, action: 'update', taskId: 'sys-1',
        projectMode: 'none',
        title: 'Mua thép tấm',
        deadlineISO: '2026-07-01', status: 'Đang xử lý', criteria: '', proposal: '', decision: '', notes: '',
      },
    ]))

    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.updated).toBe(1)
    expect(mockSetTaskStatusAdmin).toHaveBeenCalledWith(
      'sys-1', 'pm1', expect.objectContaining({ status: 'IN_PROGRESS' }),
    )
  })
})
