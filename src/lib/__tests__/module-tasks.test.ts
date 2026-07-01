import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'

vi.mock('@/lib/work-engine', () => ({
  createTask: vi.fn(),
}))

import { createTask } from '@/lib/work-engine'
import { createModuleTask } from '@/lib/module-tasks'

const mockCreateTask = vi.mocked(createTask)

describe('createModuleTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a task with correct externalRef and returns taskId', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null)
    mockCreateTask.mockResolvedValue({ id: 'task-1' } as never)

    const result = await createModuleTask('TBCG', 'maint-001', {
      taskType: 'TBCG_REPAIR',
      title: 'Sửa chữa khẩn cấp',
      assigneeRoles: ['R13', 'R06'],
    }, 'user-1')

    expect(result).toBe('task-1')
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: 'TBCG_REPAIR',
        title: 'Sửa chữa khẩn cấp',
        assignees: [{ role: 'R13' }, { role: 'R06' }],
      }),
      'user-1',
      { externalRef: 'MOD:TBCG:maint-001', externalSource: 'MODULE_TBCG' },
    )
  })

  it('idempotent: returns existing task.id without calling createTask', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 'existing-task' } as never)

    const result = await createModuleTask('TBCG', 'maint-001', {
      taskType: 'TBCG_REPAIR',
      title: 'Sửa chữa khẩn cấp',
      assigneeRoles: ['R13'],
    }, 'user-1')

    expect(result).toBe('existing-task')
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('idempotent: two calls with same entityKey produce one task', async () => {
    prismaMock.task.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'task-1' } as never)
    mockCreateTask.mockResolvedValue({ id: 'task-1' } as never)

    const r1 = await createModuleTask('HSE', 'inc-001', {
      taskType: 'HSE_INVESTIGATION',
      title: 'Test',
      assigneeRoles: ['R09'],
    }, 'u1')
    const r2 = await createModuleTask('HSE', 'inc-001', {
      taskType: 'HSE_INVESTIGATION',
      title: 'Test',
      assigneeRoles: ['R09'],
    }, 'u1')

    expect(r1).toBe('task-1')
    expect(r2).toBe('task-1')
    expect(mockCreateTask).toHaveBeenCalledTimes(1)
  })

  it('falls back to R06/R01 when assignee resolution fails', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null)
    mockCreateTask
      .mockRejectedValueOnce(new Error('Không tìm được người nhận cho role R13'))
      .mockResolvedValueOnce({ id: 'task-fallback' } as never)
    prismaMock.user.findFirst.mockResolvedValue({ id: 'user-r06' } as never)

    const result = await createModuleTask('TBCG', 'maint-002', {
      taskType: 'TBCG_REPAIR',
      title: 'Test fallback',
      assigneeRoles: ['R13'],
    }, 'user-1')

    expect(result).toBe('task-fallback')
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { roleCode: { in: ['R06', 'R01'] }, isActive: true },
    }))
  })

  it('returns null when no assignees at all (no throw)', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null)
    mockCreateTask.mockRejectedValue(new Error('Không tìm được người nhận cho role R99'))
    prismaMock.user.findFirst.mockResolvedValue(null)

    const result = await createModuleTask('TBCG', 'maint-003', {
      taskType: 'TBCG_REPAIR',
      title: 'No one available',
      assigneeRoles: ['R99'],
    }, 'user-1')

    expect(result).toBeNull()
  })

  it('returns null on unexpected error (no throw)', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null)
    mockCreateTask.mockRejectedValue(new Error('Database timeout'))

    const result = await createModuleTask('HSE', 'inc-err', {
      taskType: 'HSE_INVESTIGATION',
      title: 'Error case',
      assigneeRoles: ['R09'],
    }, 'user-1')

    expect(result).toBeNull()
  })

  it('NCR idempotent: ITP auto-NCR and manual NCR share same task via ncrCode', async () => {
    // First call (ITP auto-NCR creates the task)
    prismaMock.task.findUnique.mockResolvedValueOnce(null)
    mockCreateTask.mockResolvedValueOnce({ id: 'ncr-task-1' } as never)

    const r1 = await createModuleTask('QC_NCR', 'NCR-26-001', {
      projectId: 'proj-1',
      taskType: 'QC_NCR',
      title: 'Xử lý NCR NCR-26-001',
      assigneeRoles: ['R09', 'R09a', 'R06'],
    }, 'u1')

    expect(r1).toBe('ncr-task-1')
    expect(mockCreateTask).toHaveBeenCalledTimes(1)
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.objectContaining({ externalRef: 'MOD:QC_NCR:NCR-26-001' }),
    )

    // Second call (manual NCR POST with same ncrCode → idempotent)
    prismaMock.task.findUnique.mockResolvedValueOnce({ id: 'ncr-task-1' } as never)

    const r2 = await createModuleTask('QC_NCR', 'NCR-26-001', {
      projectId: 'proj-1',
      taskType: 'QC_NCR',
      title: 'Xử lý NCR NCR-26-001',
      assigneeRoles: ['R09', 'R09a', 'R06'],
    }, 'u2')

    expect(r2).toBe('ncr-task-1')
    expect(mockCreateTask).toHaveBeenCalledTimes(1) // still 1 — no second createTask
  })
})
