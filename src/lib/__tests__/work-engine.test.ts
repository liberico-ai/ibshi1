/**
 * Unit tests cho work-engine (Workflow động Phase 1).
 * Prisma deep-mock qua __mocks__/db.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'
import { createTask, completeTask, returnTask, reassignTask, suggestRoute, setTaskStatusAdmin } from '@/lib/work-engine'

beforeEach(() => {
  // $transaction: hàm → gọi với prismaMock; mảng → Promise.all
  ;(prismaMock.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: typeof prismaMock) => unknown)(prismaMock) : Promise.all(arg as unknown[]),
  )
  prismaMock.user.findMany.mockResolvedValue([] as never)
  prismaMock.notification.createMany.mockResolvedValue({ count: 0 } as never)
  prismaMock.notification.create.mockResolvedValue({} as never)
})

describe('createTask', () => {
  it('tạo task + assignees + docs + history, set assignedAt', async () => {
    prismaMock.task.create.mockResolvedValue({ id: 't1', title: 'Mua thép' } as never)
    prismaMock.taskAssignee.createMany.mockResolvedValue({ count: 1 } as never)
    prismaMock.taskDocRequirement.createMany.mockResolvedValue({ count: 1 } as never)
    prismaMock.taskHistory.createMany.mockResolvedValue({ count: 2 } as never)

    const task = await createTask({
      title: 'Mua thép', taskType: 'FREE', priority: 'HIGH',
      assignees: [{ role: 'R07', isPrimary: true }],
      docs: [{ kind: 'MUST_RETURN', label: 'Mã PO' }],
    } as never, 'creator')

    expect(task.id).toBe('t1')
    expect(prismaMock.task.create).toHaveBeenCalled()
    expect(prismaMock.taskAssignee.createMany).toHaveBeenCalled()
    expect(prismaMock.taskHistory.createMany).toHaveBeenCalled()
  })
})

describe('completeTask', () => {
  it('chặn nếu người gọi không phải người nhận', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 't1', status: 'OPEN', createdBy: 'c', assignees: [{ userId: 'u2', role: 'R09' }], docs: [] } as never)
    await expect(completeTask('t1', 'u1', 'R02', {})).rejects.toThrow(/không phải người nhận/i)
  })

  it('chặn nếu thiếu tài liệu MUST_RETURN', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: 't1', status: 'IN_PROGRESS', createdBy: 'c',
      assignees: [{ userId: 'u1', role: 'R07' }],
      docs: [{ id: 'd1', kind: 'MUST_RETURN', label: 'Mã PO', fulfilled: false }],
    } as never)
    await expect(completeTask('t1', 'u1', 'R07', {})).rejects.toThrow(/Cần nộp tài liệu/i)
  })

  it('hoàn thành khi đã nộp đủ tài liệu phải trả', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: 't1', status: 'IN_PROGRESS', createdBy: 'c',
      assignees: [{ userId: 'u1', role: 'R07' }],
      docs: [{ id: 'd1', kind: 'MUST_RETURN', label: 'Mã PO', fulfilled: false }],
    } as never)
    prismaMock.taskDocRequirement.update.mockResolvedValue({} as never)
    prismaMock.task.update.mockResolvedValue({} as never)
    prismaMock.taskHistory.create.mockResolvedValue({} as never)

    const r = await completeTask('t1', 'u1', 'R07', { returnedDocs: [{ requirementId: 'd1' }] })
    expect(r.ok).toBe(true)
    expect(prismaMock.taskDocRequirement.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'd1' } }))
    expect(prismaMock.task.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'DONE' }) }))
  })
})

describe('returnTask', () => {
  it('trả lại (sai phạm vi) → RETURNED + tăng returnCount + ghi history', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 't1', title: 'X', createdBy: 'creator', assignees: [{ role: 'R02', userId: null }] } as never)
    prismaMock.task.update.mockResolvedValue({} as never)
    prismaMock.taskHistory.create.mockResolvedValue({} as never)

    const r = await returnTask('t1', 'u9', 'R02', 'Sai phạm vi - thuộc QA/QC')
    expect(r.ok).toBe(true)
    expect(r.returnedTo).toBe('creator')
    expect(prismaMock.task.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'RETURNED', returnCount: { increment: 1 } }) }))
    expect(prismaMock.taskHistory.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'RETURNED', reason: 'Sai phạm vi - thuộc QA/QC' }) }))
  })
})

describe('reject inactive assignee', () => {
  it('createTask rejects inactive userId', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'inactive1', fullName: 'Trịnh Hữu Hưng', username: 'nv190549', roleCode: 'R06b', isActive: false },
    ] as never)

    await expect(createTask({
      title: 'Test', taskType: 'FREE', priority: 'NORMAL',
      assignees: [{ userId: 'inactive1', isPrimary: true }],
    } as never, 'creator')).rejects.toThrow(/Tài khoản đã vô hiệu/)
  })

  it('reassignTask rejects inactive userId', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 't1', title: 'X', projectId: null, deadline: null } as never)
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'inactive1', fullName: 'Trịnh Hữu Hưng', username: 'nv190549', isActive: false },
    ] as never)

    await expect(reassignTask('t1', 'admin', {
      assignees: [{ userId: 'inactive1', isPrimary: true }],
    } as never)).rejects.toThrow(/Tài khoản đã vô hiệu/)
  })

  it('createTask allows active userId', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'active1', fullName: 'Trịnh Hữu Hưng', username: 'hungth', roleCode: 'R07', isActive: true },
    ] as never)
    prismaMock.task.create.mockResolvedValue({ id: 't2', title: 'OK' } as never)
    prismaMock.taskAssignee.createMany.mockResolvedValue({ count: 1 } as never)
    prismaMock.taskHistory.createMany.mockResolvedValue({ count: 1 } as never)
    prismaMock.notification.createMany.mockResolvedValue({ count: 0 } as never)

    const task = await createTask({
      title: 'OK', taskType: 'FREE', priority: 'NORMAL',
      assignees: [{ userId: 'active1', isPrimary: true }],
    } as never, 'creator')
    expect(task.id).toBe('t2')
  })
})

describe('setTaskStatusAdmin', () => {
  const baseTask = {
    id: 't1', title: 'Việc test', status: 'IN_PROGRESS', createdBy: 'creator',
    projectId: null, resultData: { briefing: { criteria: 'cũ' } },
    assignees: [{ id: 'a1', userId: 'u1', role: 'R02' }, { id: 'a2', userId: 'u2', role: 'R06' }],
  }

  it('DONE → completedAt + mọi assignee done + blocked=false + History STATUS_DONE', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ ...baseTask } as never)
    prismaMock.task.update.mockResolvedValue({} as never)
    prismaMock.taskAssignee.updateMany.mockResolvedValue({ count: 2 } as never)
    prismaMock.taskHistory.create.mockResolvedValue({} as never)
    prismaMock.notification.create.mockResolvedValue({} as never)

    const r = await setTaskStatusAdmin('t1', 'admin', { status: 'DONE', blocked: true, reason: 'Giao ban: Xong' })
    expect(r).toEqual({ ok: true, status: 'DONE', wasEscalated: false })
    expect(prismaMock.task.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'DONE', blocked: false, completedAt: expect.any(Date), completedBy: 'admin' }),
    }))
    expect(prismaMock.taskAssignee.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { taskId: 't1' }, data: expect.objectContaining({ done: true, doneAt: expect.any(Date) }),
    }))
    expect(prismaMock.taskHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'STATUS_DONE', meta: expect.objectContaining({ source: 'briefing' }) }),
    }))
  })

  it('"Tắc" → cột blocked=true + resultData.briefing.blocked==="true"', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ ...baseTask } as never)
    prismaMock.task.update.mockResolvedValue({} as never)
    prismaMock.taskHistory.create.mockResolvedValue({} as never)

    const r = await setTaskStatusAdmin('t1', 'admin', { status: 'IN_PROGRESS', blocked: true })
    expect(r).toEqual({ ok: true, status: 'IN_PROGRESS', wasEscalated: false })
    expect(prismaMock.task.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'IN_PROGRESS',
        blocked: true,
        resultData: expect.objectContaining({ briefing: expect.objectContaining({ blocked: 'true' }) }),
      }),
    }))
  })

  it('RETURNED → returnCount increment + History STATUS_RETURNED', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ ...baseTask } as never)
    prismaMock.task.update.mockResolvedValue({} as never)
    prismaMock.taskHistory.create.mockResolvedValue({} as never)
    prismaMock.notification.create.mockResolvedValue({} as never)

    const r = await setTaskStatusAdmin('t1', 'admin', { status: 'RETURNED', reason: 'Giao ban: Bị trả lại' })
    expect(r).toEqual({ ok: true, status: 'RETURNED', wasEscalated: false })
    expect(prismaMock.task.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'RETURNED', returnCount: { increment: 1 } }),
    }))
    expect(prismaMock.taskHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'STATUS_RETURNED' }),
    }))
  })

  it('status sai → throw', async () => {
    await expect(setTaskStatusAdmin('t1', 'admin', { status: 'INVALID' }))
      .rejects.toThrow('Trạng thái không hợp lệ')
  })
})

describe('suggestRoute', () => {
  it('trả gợi ý theo fromContext', async () => {
    prismaMock.routingSuggestion.findMany.mockResolvedValue([{ toRoleCode: 'R07', toDepartmentCode: 'PKTKT', reason: 'Tìm NCC' }] as never)
    const s = await suggestRoute('P2.1')
    expect(s).toHaveLength(1)
    expect(prismaMock.routingSuggestion.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { fromContext: 'P2.1' } }))
  })
})
