/**
 * Unit tests cho work-engine (Workflow động Phase 1).
 * Prisma deep-mock qua __mocks__/db.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'
import { createTask, completeTask, returnTask, reassignTask, editTaskAssignees, createChangeRequest, resolveChangeRequest, suggestRoute, setTaskStatusAdmin } from '@/lib/work-engine'

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

describe('editTaskAssignees', () => {
  const baseTask = (assignees: unknown[]) => ({
    id: 't1', createdBy: 'creator', status: 'IN_PROGRESS', projectId: null, deadline: null,
    title: 'X', assignedAt: new Date(), assignees,
  })

  it('CHỈ Quản trị hệ thống (R10) được sửa người nhận', async () => {
    // roleCode khác R10 → chặn ngay (kể cả người tạo việc)
    await expect(editTaskAssignees('t1', 'creator', 'R04', [{ userId: 'u1' }])).rejects.toThrow('Chỉ Quản trị hệ thống')
  })

  it('CHẶN bỏ người đã hoàn thành phần việc', async () => {
    prismaMock.task.findUnique.mockResolvedValue(baseTask([
      { id: 'a1', userId: 'u1', role: null, done: true, isPrimary: true },
      { id: 'a2', userId: 'u2', role: null, done: false, isPrimary: false },
    ]) as never)
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u2', fullName: 'U2', username: 'u2', roleCode: 'R04', isActive: true }] as never)
    // admin R10 bỏ u1 (đã done) → phải báo lỗi
    await expect(editTaskAssignees('t1', 'admin', 'R10', [{ userId: 'u2' }])).rejects.toThrow('Không thể bỏ người đã hoàn thành')
    expect(prismaMock.taskAssignee.deleteMany).not.toHaveBeenCalled()
  })

  it('admin bỏ người CHƯA done, giữ người đã done → còn lại đều done → AWAITING_REVIEW', async () => {
    prismaMock.task.findUnique.mockResolvedValue(baseTask([
      { id: 'a1', userId: 'u1', role: null, done: true, isPrimary: true },
      { id: 'a2', userId: 'u2', role: null, done: false, isPrimary: false },
    ]) as never)
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', fullName: 'U1', username: 'u1', roleCode: 'R04', isActive: true }] as never)
    prismaMock.taskAssignee.deleteMany.mockResolvedValue({ count: 1 } as never)
    prismaMock.taskAssignee.findMany.mockResolvedValue([{ done: true }] as never)
    prismaMock.task.update.mockResolvedValue({} as never)
    prismaMock.taskHistory.create.mockResolvedValue({} as never)

    const r = await editTaskAssignees('t1', 'admin', 'R10', [{ userId: 'u1' }])
    expect(r.allDone).toBe(true)
    expect(prismaMock.taskAssignee.deleteMany).toHaveBeenCalled() // xóa a2 (u2 chưa done)
    expect(prismaMock.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'AWAITING_REVIEW' }) }),
    )
  })
})

describe('createChangeRequest (guards)', () => {
  const t = (o: Record<string, unknown>) => ({ id: 't1', createdBy: 'creator', status: 'IN_PROGRESS', resultData: null, assignees: [], title: 'X', projectId: null, ...o })
  it('chỉ người tạo việc mới gửi yêu cầu', async () => {
    prismaMock.task.findUnique.mockResolvedValue(t({}) as never)
    await expect(createChangeRequest('t1', 'khac', { type: 'DELETE', reason: 'x' })).rejects.toThrow('Chỉ người tạo việc')
  })
  it('DELETE bị chặn nếu có người đã done', async () => {
    prismaMock.task.findUnique.mockResolvedValue(t({ assignees: [{ done: true }] }) as never)
    await expect(createChangeRequest('t1', 'creator', { type: 'DELETE', reason: 'x' })).rejects.toThrow('không thể xóa')
  })
  it('chặn khi đã có yêu cầu PENDING', async () => {
    prismaMock.task.findUnique.mockResolvedValue(t({ resultData: { changeRequest: { status: 'PENDING' } } }) as never)
    await expect(createChangeRequest('t1', 'creator', { type: 'EDIT_ASSIGNEES', reason: 'x' })).rejects.toThrow('đã có yêu cầu')
  })
})

describe('resolveChangeRequest', () => {
  const withCr = (type: string, extra: Record<string, unknown> = {}) => ({
    id: 't1', createdBy: 'creator', status: 'IN_PROGRESS', title: 'X', assignees: [],
    resultData: { changeRequest: { type, status: 'PENDING', reason: 'r', requestedBy: 'creator', adminTaskId: 'adm1' } },
    ...extra,
  })
  beforeEach(() => {
    prismaMock.task.update.mockResolvedValue({} as never)
    prismaMock.taskHistory.create.mockResolvedValue({} as never)
  })
  it('chỉ R10 xử lý', async () => {
    await expect(resolveChangeRequest('t1', 'u', 'R04', { action: 'EXECUTE' })).rejects.toThrow('Chỉ Quản trị hệ thống')
  })
  it('REJECT → gỡ khóa (đánh dấu REJECTED)', async () => {
    prismaMock.task.findUnique.mockResolvedValue(withCr('DELETE') as never)
    await resolveChangeRequest('t1', 'admin', 'R10', { action: 'REJECT', note: 'không cần' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (prismaMock.task.update as any).mock.calls.find((c: any) => c[0]?.data?.resultData?.changeRequest?.status === 'REJECTED')
    expect(call).toBeTruthy()
  })
  it('EXECUTE DELETE → hủy mềm (CANCELLED)', async () => {
    prismaMock.task.findUnique.mockResolvedValue(withCr('DELETE') as never)
    await resolveChangeRequest('t1', 'admin', 'R10', { action: 'EXECUTE' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (prismaMock.task.update as any).mock.calls.find((c: any) => c[0]?.data?.status === 'CANCELLED')
    expect(call).toBeTruthy()
  })
  it('EXECUTE DELETE bị chặn nếu có người đã done', async () => {
    prismaMock.task.findUnique.mockResolvedValue(withCr('DELETE', { assignees: [{ done: true }] }) as never)
    await expect(resolveChangeRequest('t1', 'admin', 'R10', { action: 'EXECUTE' })).rejects.toThrow('không thể xóa')
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
    prismaMock.$executeRaw.mockResolvedValue(1 as never)

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

  it('"Tắc" → cột blocked=true + atomic briefing merge via $executeRaw', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ ...baseTask } as never)
    prismaMock.task.update.mockResolvedValue({} as never)
    prismaMock.taskHistory.create.mockResolvedValue({} as never)
    prismaMock.$executeRaw.mockResolvedValue(1 as never)

    const r = await setTaskStatusAdmin('t1', 'admin', { status: 'IN_PROGRESS', blocked: true })
    expect(r).toEqual({ ok: true, status: 'IN_PROGRESS', wasEscalated: false })
    expect(prismaMock.$executeRaw).toHaveBeenCalled()
    expect(prismaMock.task.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'IN_PROGRESS',
        blocked: true,
      }),
    }))
  })

  it('RETURNED → returnCount increment + History STATUS_RETURNED', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ ...baseTask } as never)
    prismaMock.task.update.mockResolvedValue({} as never)
    prismaMock.taskHistory.create.mockResolvedValue({} as never)
    prismaMock.notification.create.mockResolvedValue({} as never)
    prismaMock.$executeRaw.mockResolvedValue(1 as never)

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

  it('giữ blocked khi không truyền blocked (decision only)', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ ...baseTask, blocked: true } as never)
    prismaMock.task.update.mockResolvedValue({} as never)
    prismaMock.taskHistory.create.mockResolvedValue({} as never)
    prismaMock.$executeRaw.mockResolvedValue(1 as never)

    const r = await setTaskStatusAdmin('t1', 'admin', {
      status: 'IN_PROGRESS',
      briefingPatch: { decision: 'Duyệt' },
    })
    expect(r.status).toBe('IN_PROGRESS')
    expect(prismaMock.task.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ blocked: true }),
    }))
  })

  it('giữ blocked khi chỉ escalate', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ ...baseTask, blocked: true, escalated: false } as never)
    prismaMock.task.update.mockResolvedValue({} as never)
    prismaMock.taskHistory.create.mockResolvedValue({} as never)
    prismaMock.$executeRaw.mockResolvedValue(1 as never)
    prismaMock.user.findUnique.mockResolvedValue(null)

    const r = await setTaskStatusAdmin('t1', 'admin', {
      status: 'IN_PROGRESS',
      escalated: true,
    })
    expect(r.status).toBe('IN_PROGRESS')
    expect(prismaMock.task.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ blocked: true, escalated: true }),
    }))
  })

  it('DONE xóa blocked dù task đang Tắc', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ ...baseTask, blocked: true } as never)
    prismaMock.task.update.mockResolvedValue({} as never)
    prismaMock.taskAssignee.updateMany.mockResolvedValue({ count: 2 } as never)
    prismaMock.taskHistory.create.mockResolvedValue({} as never)
    prismaMock.notification.create.mockResolvedValue({} as never)
    prismaMock.$executeRaw.mockResolvedValue(1 as never)

    const r = await setTaskStatusAdmin('t1', 'admin', { status: 'DONE' })
    expect(prismaMock.task.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'DONE', blocked: false }),
    }))
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
