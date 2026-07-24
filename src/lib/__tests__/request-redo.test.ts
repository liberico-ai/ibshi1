import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'

vi.mock('@/lib/db', () => ({ default: prismaMock }))
vi.mock('@/lib/webhook', () => ({ emitTaskUpdated: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/telegram', () => ({ sendGroupMessage: vi.fn(), escapeHtml: (s: string) => s, formatDeadline: () => '' }))

import { requestRedo } from '@/lib/work-engine'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const baseTask = (over: Record<string, unknown> = {}): any => ({
  id: 't1', title: 'Việc X', createdBy: 'creator', status: 'AWAITING_REVIEW',
  assignees: [{ id: 'a1', userId: 'u2', role: 'R06', done: true }], ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(prismaMock.$transaction as any).mockImplementation((arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg as Promise<unknown>[]) : (arg as (tx: unknown) => unknown)(prismaMock))
  prismaMock.task.update.mockResolvedValue({} as never)
  prismaMock.taskAssignee.updateMany.mockResolvedValue({ count: 1 } as never)
  prismaMock.taskHistory.create.mockResolvedValue({} as never)
  prismaMock.notification.create.mockResolvedValue({} as never)
})

describe('requestRedo — Yêu cầu làm lại (người tạo)', () => {
  it('KHÔNG phải người tạo → throw', async () => {
    prismaMock.task.findUnique.mockResolvedValue(baseTask() as never)
    await expect(requestRedo('t1', 'u2', 'sửa lại')).rejects.toThrow(/người tạo/)
  })

  it('reason rỗng → throw', async () => {
    prismaMock.task.findUnique.mockResolvedValue(baseTask() as never)
    await expect(requestRedo('t1', 'creator', '   ')).rejects.toThrow(/lý do/)
  })

  it('task DONE → throw (không yêu cầu làm lại)', async () => {
    prismaMock.task.findUnique.mockResolvedValue(baseTask({ status: 'DONE' }) as never)
    await expect(requestRedo('t1', 'creator', 'x')).rejects.toThrow(/hoàn thành/)
  })

  it('chưa về người tạo (OPEN, chưa ai done) → throw', async () => {
    prismaMock.task.findUnique.mockResolvedValue(baseTask({ status: 'OPEN', assignees: [{ id: 'a1', userId: 'u2', done: false }] }) as never)
    await expect(requestRedo('t1', 'creator', 'x')).rejects.toThrow(/trả về/)
  })

  it('happy: status→IN_PROGRESS + reset assignee + log REDO_REQUESTED + notify người nhận', async () => {
    prismaMock.task.findUnique.mockResolvedValue(baseTask() as never)
    const r = await requestRedo('t1', 'creator', 'Thiếu mục 3')
    expect(r.status).toBe('IN_PROGRESS')
    expect(prismaMock.task.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'IN_PROGRESS' }) }))
    expect(prismaMock.taskAssignee.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { taskId: 't1' }, data: expect.objectContaining({ done: false, doneAt: null }) }))
    expect(prismaMock.taskHistory.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'REDO_REQUESTED', byUserId: 'creator', reason: 'Thiếu mục 3' }) }))
    expect(prismaMock.notification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'u2' }) }))
  })

  it('RETURNED cũng cho yêu cầu làm lại', async () => {
    prismaMock.task.findUnique.mockResolvedValue(baseTask({ status: 'RETURNED', assignees: [{ id: 'a1', userId: 'u2', done: false }] }) as never)
    const r = await requestRedo('t1', 'creator', 'làm lại')
    expect(r.status).toBe('IN_PROGRESS')
  })
})
