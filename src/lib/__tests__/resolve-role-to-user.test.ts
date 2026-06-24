import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'

vi.mock('@/lib/sync-engine', () => ({
  logChangeEvent: vi.fn().mockResolvedValue(undefined),
  runReverseHooks: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/validation-rules', () => ({
  runValidationRules: vi.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] }),
}))

import { resolveRoleToUser, createTask } from '@/lib/work-engine'

beforeEach(() => {
  ;(prismaMock.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: typeof prismaMock) => unknown)(prismaMock) : Promise.all(arg as unknown[]),
  )
  prismaMock.user.findMany.mockResolvedValue([] as never)
  prismaMock.notification.createMany.mockResolvedValue({ count: 0 } as never)
})

describe('resolveRoleToUser', () => {
  it('R05 → resolve người active có đúng roleCode R05 (Kho), không phải trưởng TCKT (R08)', async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: 'kho-user', fullName: 'Nguyễn Thị Hiền Lương',
    } as never)

    const result = await resolveRoleToUser('R05')
    expect(result.id).toBe('kho-user')
    expect(result.fullName).toContain('Lương')
  })

  it('role không có user active → fallback getDeptHead', async () => {
    prismaMock.user.findFirst
      .mockResolvedValueOnce(null as never) // exact role
      .mockResolvedValueOnce({ id: 'head-user', fullName: 'Trưởng phòng' } as never) // getDeptHead inner query

    const result = await resolveRoleToUser('R05')
    expect(result.id).toBe('head-user')
  })

  it('không có user nào + không có projectId → throw', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null as never)

    await expect(resolveRoleToUser('R99')).rejects.toThrow(/Không tìm được người nhận/)
  })

  it('không có user nào + có projectId → fallback PM (pmUserId)', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null as never)
    prismaMock.project.findUnique.mockResolvedValueOnce({ pmUserId: 'pm-user' } as never)
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'pm-user', fullName: 'PM Giang', isActive: true } as never)

    const result = await resolveRoleToUser('R99', 'proj-1')
    expect(result.id).toBe('pm-user')
  })
})

describe('createTask rejects role-only', () => {
  it('role-only assignee without any active user → throw (không tạo task treo phòng)', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null as never)

    await expect(createTask({
      title: 'Test', taskType: 'FREE', priority: 'NORMAL',
      assignees: [{ role: 'R99', isPrimary: true }],
    } as never, 'creator')).rejects.toThrow(/Không tìm được người nhận/)
  })

  it('role-only assignee R05 → resolved to actual user, task created', async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: 'kho-user', fullName: 'Kho User',
    } as never)
    prismaMock.task.create.mockResolvedValue({ id: 't1', title: 'Test' } as never)
    prismaMock.taskAssignee.createMany.mockResolvedValue({ count: 1 } as never)
    prismaMock.taskHistory.createMany.mockResolvedValue({ count: 1 } as never)

    const task = await createTask({
      title: 'Test', taskType: 'FREE', priority: 'NORMAL',
      assignees: [{ role: 'R05', isPrimary: true }],
    } as never, 'creator')

    expect(task.id).toBe('t1')
    const createManyCall = prismaMock.taskAssignee.createMany.mock.calls[0][0]
    const assigneeData = (createManyCall.data as { userId: string }[])[0]
    expect(assigneeData.userId).toBe('kho-user')
  })
})
