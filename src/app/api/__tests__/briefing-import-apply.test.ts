import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prismaMock } from '@/lib/__mocks__/db'

const { mockAuthUser } = vi.hoisted(() => ({
  mockAuthUser: {
    userId: 'user-pm',
    roleCode: 'R02',
    username: 'pm01',
    userLevel: 2,
    fullName: 'PM User',
  },
}))

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return {
    ...actual,
    authenticateRequest: vi.fn().mockResolvedValue(mockAuthUser),
  }
})

vi.mock('@/lib/work-engine', async () => {
  const actual = await vi.importActual<typeof import('@/lib/work-engine')>('@/lib/work-engine')
  return {
    ...actual,
    resolveRoleToUser: vi.fn().mockResolvedValue({ id: 'resolved-role-user', fullName: 'Resolved User' }),
  }
})

import { POST } from '@/app/api/work/briefing/import/route'

function buildApplyRequest(rows: unknown[]): NextRequest {
  return new NextRequest('http://localhost/api/work/briefing/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  })
}

function setupMocks() {
  prismaMock.project.findMany.mockResolvedValue([])

  let projCounter = 0
  prismaMock.project.create.mockImplementation(async (args) => {
    projCounter++
    return {
      id: `new-proj-${projCounter}`,
      projectCode: (args as { data: { projectCode: string } }).data.projectCode,
      projectName: (args as { data: { projectName: string } }).data.projectName,
      clientName: '(BBH)',
      productType: 'OTHER',
      projectType: 'OTHER',
      status: 'ACTIVE',
      currency: 'VND',
      contractValue: null,
      startDate: null,
      endDate: null,
      pmUserId: null,
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  })

  prismaMock.user.findMany.mockResolvedValue([
    { id: 'u1', fullName: 'Nguyễn Văn A', username: 'nva', roleCode: 'R07', isActive: true } as never,
  ])

  prismaMock.task.findMany.mockResolvedValue([])
  prismaMock.task.findUnique.mockResolvedValue(null)
  prismaMock.task.update.mockResolvedValue({} as never)

  prismaMock.$executeRaw.mockResolvedValue(1 as never)
  prismaMock.$transaction.mockImplementation(async (fn) => {
    if (typeof fn === 'function') {
      return fn(prismaMock as never)
    }
    return []
  })
  prismaMock.task.create.mockResolvedValue({ id: 'new-task-1' } as never)
  prismaMock.taskAssignee.create.mockResolvedValue({} as never)
  prismaMock.taskAssignee.updateMany.mockResolvedValue({ count: 0 } as never)
  prismaMock.taskHistory.create.mockResolvedValue({} as never)
  prismaMock.notification.create.mockResolvedValue({} as never)
}

describe('POST /api/work/briefing/import (apply via JSON)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  // ── Case 1: update taskId → status/deadline/briefing via setTaskStatusAdmin ──
  it('(1) update by taskId → changes status, deadline, briefing fields + creates STATUS_SET history', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: 'task-exist-1',
      status: 'OPEN',
      resultData: { briefing: { criteria: 'cũ', importKey: 'abc' } },
      assignees: [{ id: 'a1', userId: 'u1', role: 'R07' }],
    } as never)

    const req = buildApplyRequest([{
      include: true,
      action: 'update',
      taskId: 'task-exist-1',
      projectMode: 'existing',
      title: 'Công việc cũ',
      deadlineISO: '2026-07-15',
      status: 'Đang xử lý',
      criteria: 'Tiêu chí mới',
      proposal: 'Đề xuất mới',
      decision: 'Quyết định BGĐ',
      notes: 'Ghi chú cập nhật',
    }])

    const res = await POST(req)
    const json = await res.json()

    expect(json.ok).toBe(true)
    expect(json.summary.updated).toBe(1)
    expect(json.summary.created).toBe(0)

    // Briefing merged atomically via $executeRaw (not in task.update payload)
    expect(prismaMock.$executeRaw).toHaveBeenCalled()
    // task.update carries status/deadline/blocked but NOT resultData
    expect(prismaMock.task.update).toHaveBeenCalledWith({
      where: { id: 'task-exist-1' },
      data: expect.objectContaining({
        status: 'IN_PROGRESS',
        deadline: new Date('2026-07-15'),
      }),
    })

    // TaskHistory created via setTaskStatusAdmin with STATUS_SET action
    expect(prismaMock.taskHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: 'task-exist-1',
        action: 'STATUS_SET',
        byUserId: 'user-pm',
        meta: expect.objectContaining({ source: 'briefing' }),
      }),
    })
  })

  // ── Case 2: create + existing project → Task gắn projectId + TaskAssignee userId ──
  it('(2) create + existing project → task linked to projectId + assignee by userId', async () => {
    prismaMock.project.findMany.mockResolvedValue([
      { id: 'proj-abc', projectCode: '25-ABC', projectName: 'Dự án ABC' } as never,
    ])

    const req = buildApplyRequest([{
      include: true,
      action: 'create',
      projectMode: 'existing',
      projectId: 'proj-abc',
      projectCode: '25-ABC',
      title: 'Lắp đặt kết cấu',
      assigneeUserIds: ['u1'],
      roleCode: 'R07',
      deadlineISO: '2026-07-10',
      status: 'Mới',
      criteria: 'Hoàn thành lắp đặt',
      proposal: '',
      decision: '',
      notes: '',
    }])

    const res = await POST(req)
    const json = await res.json()

    expect(json.ok).toBe(true)
    expect(json.summary.created).toBe(1)
    expect(json.summary.projectsCreated).toBe(0)

    // task.create with projectId pointing to existing project
    expect(prismaMock.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 'proj-abc',
        title: 'Lắp đặt kết cấu',
        taskType: 'FREE',
        status: 'OPEN',
      }),
    })

    // TaskAssignee with userId
    expect(prismaMock.taskAssignee.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        isPrimary: true,
      }),
    })
  })

  // ── Case 3: create + projectMode='create' → new Project (idempotent) + Task ──
  it('(3) create + projectMode=create → creates new Project idempotently then Task', async () => {
    const req = buildApplyRequest([{
      include: true,
      action: 'create',
      projectMode: 'create',
      projectCode: '27-NEW',
      projectNameNew: 'Dự án Mới XYZ',
      title: 'Thiết kế bản vẽ',
      assigneeUserIds: ['u1'],
      roleCode: 'R07',
      deadlineISO: '2026-06-25',
      status: 'Mới',
      criteria: 'Bản vẽ xong',
      proposal: '',
      decision: '',
      notes: '',
    }])

    const res = await POST(req)
    const json = await res.json()

    expect(json.ok).toBe(true)
    expect(json.summary.projectsCreated).toBe(1)
    expect(json.summary.created).toBe(1)
    expect(json.summary.errors).toBe(0)

    expect(prismaMock.project.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectCode: '27-NEW',
        projectName: 'Dự án Mới XYZ',
        clientName: '(BBH)',
        productType: 'OTHER',
      }),
    })

    expect(prismaMock.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'Thiết kế bản vẽ',
        taskType: 'FREE',
        status: 'OPEN',
      }),
    })

    // Verify task.create received the newly created project's ID
    const taskCreateCall = prismaMock.task.create.mock.calls[0][0] as { data: { projectId: string } }
    expect(taskCreateCall.data.projectId).toBe('new-proj-1')
  })

  // ── Case 4: create assigned by role → resolves to specific user ──
  it('(4) create with role assignment → TaskAssignee has role AND userId', async () => {
    const req = buildApplyRequest([{
      include: true,
      action: 'create',
      projectMode: 'none',
      title: 'Kiểm tra mối hàn',
      roleCode: 'R09',
      deadlineISO: '2026-06-28',
      status: 'Mới',
      criteria: 'Đạt chuẩn',
      proposal: '',
      decision: '',
      notes: '',
    }])

    const res = await POST(req)
    const json = await res.json()

    expect(json.ok).toBe(true)
    expect(json.summary.created).toBe(1)

    expect(prismaMock.taskAssignee.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        role: 'R09',
        userId: 'resolved-role-user',
        isPrimary: true,
      }),
    })
  })

  // ── Case 5: action=create always creates new (no auto-upsert by title) ──
  it('(5) action=create with existing same-title task → still creates new', async () => {
    const req1 = buildApplyRequest([{
      include: true,
      action: 'create',
      projectMode: 'create',
      projectCode: '27-DUP',
      projectNameNew: 'Dự án dup',
      title: 'Task trùng',
      assigneeUserIds: ['u1'],
      deadlineISO: '2026-06-25',
      status: 'Mới',
      criteria: 'TC',
      proposal: '',
      decision: '',
      notes: '',
    }])
    const res1 = await POST(req1)
    const json1 = await res1.json()
    expect(json1.ok).toBe(true)
    expect(json1.summary.created).toBe(1)

    vi.clearAllMocks()
    setupMocks()

    // Project now exists
    prismaMock.project.findMany.mockResolvedValue([
      { id: 'existing-proj', projectCode: '27-DUP', projectName: 'Dự án dup' } as never,
    ])
    // Existing task with matching title + briefing data (found by upsert query)
    prismaMock.task.findMany.mockResolvedValue([
      { id: 'existing-task-1', title: 'Task trùng', resultData: { briefing: { importKey: 'abc', criteria: 'TC' } } } as never,
    ])
    prismaMock.taskAssignee.deleteMany.mockResolvedValue({ count: 1 } as never)

    const req2 = buildApplyRequest([{
      include: true,
      action: 'create',
      projectMode: 'existing',
      projectId: 'existing-proj',
      projectCode: '27-DUP',
      title: 'Task trùng',
      assigneeUserIds: ['u1'],
      deadlineISO: '2026-06-25',
      status: 'Mới',
      criteria: 'TC mới',
      proposal: '',
      decision: '',
      notes: '',
    }])
    const res2 = await POST(req2)
    const json2 = await res2.json()

    expect(json2.ok).toBe(true)
    expect(json2.summary.created).toBe(1)
    expect(json2.summary.updated).toBe(0)
    expect(json2.summary.projectsCreated).toBe(0)
  })

  // ── Case 6: include=false → row is skipped entirely ──
  it('(6) include=false rows are completely skipped', async () => {
    const req = buildApplyRequest([{
      include: false,
      action: 'create',
      projectMode: 'none',
      title: 'Bỏ qua dòng này',
      deadlineISO: '2026-06-25',
      status: 'Mới',
      criteria: '',
      proposal: '',
      decision: '',
      notes: '',
    }])

    const res = await POST(req)
    const json = await res.json()

    expect(json.ok).toBe(true)
    expect(json.created).toBe(0)
    expect(prismaMock.task.create).not.toHaveBeenCalled()
    expect(prismaMock.taskAssignee.create).not.toHaveBeenCalled()
    expect(prismaMock.taskHistory.create).not.toHaveBeenCalled()
  })
})
