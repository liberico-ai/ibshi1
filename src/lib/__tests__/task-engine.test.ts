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

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    stepCode: 'P1.1',
    stepName: 'Lập hồ sơ dự án',
    status: 'IN_PROGRESS',
    priority: 1,
    assignedRole: 'R02',
    assignedTo: null,
    deadline: new Date('2026-05-01'),
    resultData: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    project: { projectCode: 'IBS-001', projectName: 'Test Project', clientName: 'Client A' },
    assignee: null,
    ...overrides,
  }
}

// ── getTaskInbox ──

describe('getTaskInbox', () => {
  it('returns tasks assigned to the user (L2) or to the role (L1)', async () => {
    const mockTasks = [
      makeTask({ id: 'task-1', assignedTo: 'user-1' }),
      makeTask({ id: 'task-2', assignedRole: 'R02', assignedTo: null }),
    ]
    prismaMock.workflowTask.findMany.mockResolvedValue(mockTasks as never)

    const result = await getTaskInbox('user-1', 'R02')

    expect(prismaMock.workflowTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { assignedTo: 'user-1' },
            { assignedRole: 'R02', assignedTo: null },
          ],
          status: 'IN_PROGRESS',
        },
      }),
    )
    expect(result).toHaveLength(2)
  })

  it('excludes completed tasks (only queries IN_PROGRESS)', async () => {
    prismaMock.workflowTask.findMany.mockResolvedValue([] as never)

    await getTaskInbox('user-1', 'R02')

    const call = prismaMock.workflowTask.findMany.mock.calls[0][0] as { where: { status: string } }
    expect(call.where.status).toBe('IN_PROGRESS')
  })

  it('orders by priority desc, deadline asc, createdAt asc', async () => {
    prismaMock.workflowTask.findMany.mockResolvedValue([] as never)

    await getTaskInbox('user-1', 'R02')

    expect(prismaMock.workflowTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { priority: 'desc' },
          { deadline: 'asc' },
          { createdAt: 'asc' },
        ],
      }),
    )
  })
})

// ── getTasksByProject ──

describe('getTasksByProject', () => {
  it('returns tasks filtered by projectId ordered by stepCode', async () => {
    const mockTasks = [makeTask({ stepCode: 'P1.1' }), makeTask({ stepCode: 'P1.2' })]
    prismaMock.workflowTask.findMany.mockResolvedValue(mockTasks as never)

    const result = await getTasksByProject('proj-1')

    expect(prismaMock.workflowTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'proj-1' },
        orderBy: { stepCode: 'asc' },
      }),
    )
    expect(result).toHaveLength(2)
  })
})

// ── getTaskById ──

describe('getTaskById', () => {
  it('returns a single task with project and assignee includes', async () => {
    const task = makeTask({ id: 'task-99' })
    prismaMock.workflowTask.findUnique.mockResolvedValue(task as never)

    const result = await getTaskById('task-99')

    expect(prismaMock.workflowTask.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'task-99' } }),
    )
    expect(result).toEqual(task)
  })
})

// ── assignTask ──

describe('assignTask', () => {
  it('updates the task assignedTo field (L1 to L2 assignment)', async () => {
    const updated = makeTask({ id: 'task-1', assignedTo: 'user-2' })
    prismaMock.workflowTask.update.mockResolvedValue(updated as never)

    const result = await assignTask('task-1', 'user-2')

    expect(prismaMock.workflowTask.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { assignedTo: 'user-2' },
    })
    expect(result).toEqual(updated)
  })
})

// ── getDashboardStats ──

describe('getDashboardStats', () => {
  it('returns correct counts for all categories', async () => {
    prismaMock.workflowTask.count
      .mockResolvedValueOnce(50 as never)  // totalTasks
      .mockResolvedValueOnce(10 as never)  // pendingTasks
      .mockResolvedValueOnce(20 as never)  // inProgressTasks
      .mockResolvedValueOnce(15 as never)  // completedTasks
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

  it('filters by assignedRole when roleCode is not R01', async () => {
    prismaMock.workflowTask.count
      .mockResolvedValueOnce(10 as never)
      .mockResolvedValueOnce(3 as never)
      .mockResolvedValueOnce(4 as never)
      .mockResolvedValueOnce(2 as never)
      .mockResolvedValueOnce(1 as never)

    await getDashboardStats('R06')

    // The first call (totalTasks) should include assignedRole filter
    const firstCall = prismaMock.workflowTask.count.mock.calls[0][0] as { where: { assignedRole?: string } }
    expect(firstCall.where).toEqual({ assignedRole: 'R06' })
  })

  it('does not filter by role when roleCode is R01 (admin sees all)', async () => {
    prismaMock.workflowTask.count
      .mockResolvedValueOnce(100 as never)
      .mockResolvedValueOnce(20 as never)
      .mockResolvedValueOnce(30 as never)
      .mockResolvedValueOnce(40 as never)
      .mockResolvedValueOnce(10 as never)

    await getDashboardStats('R01')

    const firstCall = prismaMock.workflowTask.count.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(firstCall.where).toEqual({})
  })

  it('does not filter by role when roleCode is undefined', async () => {
    prismaMock.workflowTask.count
      .mockResolvedValueOnce(100 as never)
      .mockResolvedValueOnce(20 as never)
      .mockResolvedValueOnce(30 as never)
      .mockResolvedValueOnce(40 as never)
      .mockResolvedValueOnce(10 as never)

    await getDashboardStats()

    const firstCall = prismaMock.workflowTask.count.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(firstCall.where).toEqual({})
  })
})

// ── getBottleneckMap ──

describe('getBottleneckMap', () => {
  it('returns roles sorted by pending count descending', async () => {
    prismaMock.workflowTask.groupBy.mockResolvedValue([
      { assignedRole: 'R04', _count: { id: 5 } },
      { assignedRole: 'R06', _count: { id: 12 } },
      { assignedRole: 'R02', _count: { id: 3 } },
    ] as never)

    const result = await getBottleneckMap()

    expect(result).toEqual([
      { role: 'R06', pendingCount: 12 },
      { role: 'R04', pendingCount: 5 },
      { role: 'R02', pendingCount: 3 },
    ])
  })

  it('only queries IN_PROGRESS tasks', async () => {
    prismaMock.workflowTask.groupBy.mockResolvedValue([] as never)

    await getBottleneckMap()

    expect(prismaMock.workflowTask.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'IN_PROGRESS' },
      }),
    )
  })
})

// ── checkDeadlines ──

describe('checkDeadlines', () => {
  it('creates notifications for overdue tasks with an assignee', async () => {
    const overdueTasks = [
      makeTask({
        id: 'task-overdue-1',
        assignedTo: 'user-1',
        stepName: 'Kiểm tra vật tư',
        stepCode: 'P3.1',
        deadline: new Date('2026-01-01'),
        project: { projectCode: 'IBS-001', projectName: 'Test Project' },
      }),
    ]
    prismaMock.workflowTask.findMany.mockResolvedValue(overdueTasks as never)
    prismaMock.notification.create.mockResolvedValue({} as never)

    const count = await checkDeadlines()

    expect(count).toBe(1)
    expect(prismaMock.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        title: 'Task qu\u00e1 h\u1ea1n: Ki\u1ec3m tra v\u1eadt t\u01b0',
        message: 'Task P3.1 trong d\u1ef1 \u00e1n IBS-001 \u0111\u00e3 qu\u00e1 deadline.',
        type: 'deadline_overdue',
        linkUrl: '/tasks/task-overdue-1',
      },
    })
  })

  it('does not create notification for tasks without assignee', async () => {
    const overdueTasks = [
      makeTask({
        id: 'task-unassigned',
        assignedTo: null,
        deadline: new Date('2026-01-01'),
        project: { projectCode: 'IBS-002', projectName: 'Another Project' },
      }),
    ]
    prismaMock.workflowTask.findMany.mockResolvedValue(overdueTasks as never)

    const count = await checkDeadlines()

    expect(count).toBe(1) // still counts the task
    expect(prismaMock.notification.create).not.toHaveBeenCalled()
  })

  it('returns 0 when no overdue tasks exist', async () => {
    prismaMock.workflowTask.findMany.mockResolvedValue([] as never)

    const count = await checkDeadlines()

    expect(count).toBe(0)
    expect(prismaMock.notification.create).not.toHaveBeenCalled()
  })
})

// ── getModuleStats ──

describe('getModuleStats', () => {
  it('returns correct counts for warehouse, production, and QC', async () => {
    // material.count
    prismaMock.material.count.mockResolvedValue(100 as never)
    // material.findMany for low stock
    prismaMock.material.findMany.mockResolvedValue([
      { currentStock: 5, minStock: 10 },
      { currentStock: 20, minStock: 10 },
      { currentStock: 0, minStock: 5 },
    ] as never)
    // workOrder counts
    prismaMock.workOrder.count
      .mockResolvedValueOnce(50 as never)   // totalWO
      .mockResolvedValueOnce(15 as never)   // woInProgress
      .mockResolvedValueOnce(8 as never)    // woPendingMaterial
    // inspection counts
    prismaMock.inspection.count
      .mockResolvedValueOnce(30 as never)   // totalInspections
      .mockResolvedValueOnce(22 as never)   // inspectionsPassed
      .mockResolvedValueOnce(5 as never)    // inspectionsPending

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
