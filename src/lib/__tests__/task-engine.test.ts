// ── Mock Prisma ──
import { prismaMock } from '@/lib/__mocks__/db'
import {
  getTaskInbox,
  getTasksByProject,
  getTaskById,
  assignTask,
  getDashboardStats,
  getBottleneckMap,
  checkDeadlines,
  getModuleStats,
} from '@/lib/task-engine'

// ── Helpers ──

function makeDynamicTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    taskType: 'P1.1',
    title: 'Lập hồ sơ dự án',
    description: null,
    status: 'IN_PROGRESS',
    priority: 'NORMAL',
    deadline: new Date('2026-05-01'),
    startedAt: new Date('2026-01-01'),
    completedAt: null,
    completedBy: null,
    resultData: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    assignees: [{ role: 'R02', userId: null, isPrimary: true }],
    project: { projectCode: 'IBS-001', projectName: 'Test Project', clientName: 'Client A' },
    ...overrides,
  }
}

// ── getTaskInbox ──

describe('getTaskInbox', () => {
  it('returns tasks assigned to the user (L2) or to the role (L1)', async () => {
    const mockTasks = [
      makeDynamicTask({ id: 'task-1', assignees: [{ role: 'R02', userId: 'user-1', isPrimary: true }] }),
      makeDynamicTask({ id: 'task-2', assignees: [{ role: 'R02', userId: null, isPrimary: true }] }),
    ]
    prismaMock.task.findMany.mockResolvedValue(mockTasks as never)
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'user-1', fullName: 'Test User', username: 'testuser' },
    ] as never)

    const result = await getTaskInbox('user-1', 'R02')

    expect(prismaMock.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { in: ['OPEN', 'IN_PROGRESS', 'RETURNED'] },
          assignees: { some: { OR: [{ userId: 'user-1' }, { role: 'R02' }] } },
        },
      }),
    )
    expect(result).toHaveLength(2)
  })

  it('excludes completed tasks (only queries active statuses)', async () => {
    prismaMock.task.findMany.mockResolvedValue([] as never)

    await getTaskInbox('user-1', 'R02')

    const call = prismaMock.task.findMany.mock.calls[0][0] as { where: { status: { in: string[] } } }
    expect(call.where.status).toEqual({ in: ['OPEN', 'IN_PROGRESS', 'RETURNED'] })
  })

  it('orders by deadline asc, createdAt asc', async () => {
    prismaMock.task.findMany.mockResolvedValue([] as never)

    await getTaskInbox('user-1', 'R02')

    expect(prismaMock.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { deadline: 'asc' },
          { createdAt: 'asc' },
        ],
      }),
    )
  })
})

// ── getTasksByProject ──

describe('getTasksByProject', () => {
  it('returns tasks filtered by projectId ordered by createdAt', async () => {
    const mockTasks = [
      makeDynamicTask({ taskType: 'P1.1' }),
      makeDynamicTask({ taskType: 'P1.2' }),
    ]
    prismaMock.task.findMany.mockResolvedValue(mockTasks as never)
    prismaMock.user.findMany.mockResolvedValue([] as never)

    const result = await getTasksByProject('proj-1')

    expect(prismaMock.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'proj-1' },
        orderBy: { createdAt: 'asc' },
      }),
    )
    expect(result).toHaveLength(2)
  })
})

// ── getTaskById ──

describe('getTaskById', () => {
  it('returns a single task with project and assignee includes', async () => {
    const task = makeDynamicTask({ id: 'task-99' })
    prismaMock.task.findUnique.mockResolvedValue(task as never)
    prismaMock.user.findUnique.mockResolvedValue(null as never)

    const result = await getTaskById('task-99')

    expect(prismaMock.task.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'task-99' } }),
    )
    expect(result).toBeDefined()
    expect(result!.id).toBe('task-99')
    expect(result!.stepCode).toBe('P1.1')
  })
})

// ── assignTask ──

describe('assignTask', () => {
  it('updates the task assignee (L1 to L2 assignment)', async () => {
    const existing = { id: 'assignee-1', taskId: 'task-1', userId: null, isPrimary: true }
    prismaMock.taskAssignee.findFirst.mockResolvedValue(existing as never)
    prismaMock.taskAssignee.update.mockResolvedValue({ ...existing, userId: 'user-2' } as never)
    prismaMock.task.findUnique.mockResolvedValue(makeDynamicTask({ id: 'task-1' }) as never)

    const result = await assignTask('task-1', 'user-2')

    expect(prismaMock.taskAssignee.update).toHaveBeenCalledWith({
      where: { id: 'assignee-1' },
      data: { userId: 'user-2' },
    })
    expect(result).toBeDefined()
  })
})

// ── getDashboardStats ──

describe('getDashboardStats', () => {
  it('returns correct counts for all categories', async () => {
    prismaMock.task.count
      .mockResolvedValueOnce(50 as never)  // totalTasks
      .mockResolvedValueOnce(10 as never)  // pendingTasks (OPEN)
      .mockResolvedValueOnce(20 as never)  // inProgressTasks (active)
      .mockResolvedValueOnce(15 as never)  // completedTasks (DONE)
      .mockResolvedValueOnce(5 as never)   // overdueTasks

    const stats = await getDashboardStats('R02')

    expect(stats).toEqual({
      totalTasks: 50,
      pendingTasks: 10,
      inProgressTasks: 20,
      completedTasks: 15,
      overdueTasks: 5,
    })
  })

  it('filters by assignees role when roleCode is not R01', async () => {
    prismaMock.task.count
      .mockResolvedValueOnce(10 as never)
      .mockResolvedValueOnce(3 as never)
      .mockResolvedValueOnce(4 as never)
      .mockResolvedValueOnce(2 as never)
      .mockResolvedValueOnce(1 as never)

    await getDashboardStats('R06')

    const firstCall = prismaMock.task.count.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(firstCall.where).toEqual({ assignees: { some: { role: 'R06' } } })
  })

  it('does not filter by role when roleCode is R01 (admin sees all)', async () => {
    prismaMock.task.count
      .mockResolvedValueOnce(100 as never)
      .mockResolvedValueOnce(20 as never)
      .mockResolvedValueOnce(30 as never)
      .mockResolvedValueOnce(40 as never)
      .mockResolvedValueOnce(10 as never)

    await getDashboardStats('R01')

    const firstCall = prismaMock.task.count.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(firstCall.where).toEqual({})
  })

  it('does not filter by role when roleCode is undefined', async () => {
    prismaMock.task.count
      .mockResolvedValueOnce(100 as never)
      .mockResolvedValueOnce(20 as never)
      .mockResolvedValueOnce(30 as never)
      .mockResolvedValueOnce(40 as never)
      .mockResolvedValueOnce(10 as never)

    await getDashboardStats()

    const firstCall = prismaMock.task.count.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(firstCall.where).toEqual({})
  })
})

// ── getBottleneckMap ──

describe('getBottleneckMap', () => {
  it('returns roles sorted by pending count descending', async () => {
    prismaMock.task.findMany.mockResolvedValue([
      { assignees: [{ role: 'R04' }] },
      { assignees: [{ role: 'R06' }] },
      { assignees: [{ role: 'R06' }] },
      { assignees: [{ role: 'R02' }] },
      { assignees: [{ role: 'R04' }] },
    ] as never)

    const result = await getBottleneckMap()

    expect(result[0].pendingCount).toBe(2)
    expect(result[2]).toEqual({ role: 'R02', pendingCount: 1 })
  })

  it('only queries active tasks', async () => {
    prismaMock.task.findMany.mockResolvedValue([] as never)

    await getBottleneckMap()

    expect(prismaMock.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ['OPEN', 'IN_PROGRESS', 'RETURNED'] } },
      }),
    )
  })
})

// ── checkDeadlines ──

describe('checkDeadlines', () => {
  it('creates notifications for overdue tasks with an assignee', async () => {
    const overdueTasks = [
      makeDynamicTask({
        id: 'task-overdue-1',
        taskType: 'P3.1',
        title: 'Kiểm tra vật tư',
        deadline: new Date('2026-01-01'),
        assignees: [{ userId: 'user-1', isPrimary: true }],
        project: { projectCode: 'IBS-001', projectName: 'Test Project' },
      }),
    ]
    prismaMock.task.findMany.mockResolvedValue(overdueTasks as never)
    prismaMock.notification.create.mockResolvedValue({} as never)

    const count = await checkDeadlines()

    expect(count).toBe(1)
    expect(prismaMock.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        title: 'Task quá hạn: Kiểm tra vật tư',
        message: 'Task P3.1 trong dự án IBS-001 đã quá deadline.',
        type: 'deadline_overdue',
        linkUrl: '/tasks/task-overdue-1',
      },
    })
  })

  it('does not create notification for tasks without assignee', async () => {
    const overdueTasks = [
      makeDynamicTask({
        id: 'task-unassigned',
        deadline: new Date('2026-01-01'),
        assignees: [{ userId: null, isPrimary: true }],
        project: { projectCode: 'IBS-002', projectName: 'Another Project' },
      }),
    ]
    prismaMock.task.findMany.mockResolvedValue(overdueTasks as never)

    const count = await checkDeadlines()

    expect(count).toBe(1)
    expect(prismaMock.notification.create).not.toHaveBeenCalled()
  })

  it('returns 0 when no overdue tasks exist', async () => {
    prismaMock.task.findMany.mockResolvedValue([] as never)

    const count = await checkDeadlines()

    expect(count).toBe(0)
    expect(prismaMock.notification.create).not.toHaveBeenCalled()
  })
})

// ── getModuleStats ──

describe('getModuleStats', () => {
  it('returns correct counts for warehouse, production, and QC', async () => {
    prismaMock.material.count.mockResolvedValue(100 as never)
    prismaMock.material.findMany.mockResolvedValue([
      { currentStock: 5, minStock: 10 },
      { currentStock: 20, minStock: 10 },
      { currentStock: 0, minStock: 5 },
    ] as never)
    prismaMock.workOrder.count
      .mockResolvedValueOnce(50 as never)
      .mockResolvedValueOnce(15 as never)
      .mockResolvedValueOnce(8 as never)
    prismaMock.inspection.count
      .mockResolvedValueOnce(30 as never)
      .mockResolvedValueOnce(22 as never)
      .mockResolvedValueOnce(5 as never)

    const stats = await getModuleStats()

    expect(stats).toEqual({
      warehouse: { totalMaterials: 100, lowStockCount: 2 },
      production: { totalWO: 50, woInProgress: 15, woPendingMaterial: 8 },
      qc: { totalInspections: 30, inspectionsPassed: 22, inspectionsPending: 5 },
    })
  })

  it('handles zero low stock materials', async () => {
    prismaMock.material.count.mockResolvedValue(10 as never)
    prismaMock.material.findMany.mockResolvedValue([
      { currentStock: 20, minStock: 5 },
    ] as never)
    prismaMock.workOrder.count
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(0 as never)
    prismaMock.inspection.count
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(0 as never)

    const stats = await getModuleStats()

    expect(stats.warehouse.lowStockCount).toBe(0)
  })
})
