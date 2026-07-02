/**
 * Gate-driven spawn cho template có đồ thị GÃY kiểu SX-PROD prod:
 * nhiều bước nextCodes=[] → xong cả cụm song song không ai sinh bước gate (P2.4, P6.5).
 * chainNextTemplateTasks phải quét gateCodes ⊆ done-set để tự spawn (idempotent).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'

vi.mock('@/lib/db', () => ({ default: prismaMock }))
vi.mock('@/lib/telegram', () => ({ sendGroupMessage: vi.fn(), escapeHtml: (s: string) => s, formatDeadline: () => '' }))

import { chainNextTemplateTasks } from '@/lib/work-engine'

const TPL_ID = 'tpl-sxprod'

function mkStep(code: string, orderIndex: number, nextCodes: string[] = [], gateCodes: string[] = [], role = 'R02') {
  return {
    id: `step-${code}`, templateId: TPL_ID, code, title: `Step ${code}`,
    roleCode: role, deptCode: null, orderIndex, deadlineDays: null,
    taskType: code, hookKeys: [], nextCodes, gateCodes, parentCode: null,
  }
}

// Mô phỏng data GÃY như SX-PROD prod: các bước song song next=[] (chuỗi chết),
// bước gate (P2.4, P6.5) có gateCodes đúng nhưng không có cạnh next trỏ tới.
const BROKEN_STEPS = [
  mkStep('P1.1', 0, []),                                          // root, next=[] (gãy)
  mkStep('P2.1', 1, []),
  mkStep('P2.2', 2, []),
  mkStep('P2.3', 3, []),
  mkStep('P2.1A', 4, []),
  mkStep('P2.4', 5, [], ['P2.1', 'P2.2', 'P2.3', 'P2.1A'], 'R03'), // gate đúng, không ai next→
  mkStep('P6.1', 6, []),
  mkStep('P6.2', 7, []),
  mkStep('P6.3', 8, []),
  mkStep('P6.4', 9, []),
  mkStep('P6.5', 10, [], ['P6.1', 'P6.2', 'P6.3', 'P6.4'], 'R01'),
]

const stepByCode = new Map(BROKEN_STEPS.map((s) => [s.code, s]))
const doneTask = (code: string) => ({ templateStepId: `step-${code}`, status: 'DONE' })

function mockTemplate(doneCodes: string[]) {
  // Bước vừa hoàn thành sẽ được findUnique theo id
  prismaMock.templateStep.findUnique.mockImplementation(((args: { where: { id: string } }) =>
    Promise.resolve(BROKEN_STEPS.find((s) => s.id === args.where.id) || null)) as never)
  prismaMock.templateStep.findMany.mockResolvedValue(BROKEN_STEPS as never)
  // done-set: root luôn spawned+DONE để không dính legacy grace
  prismaMock.task.findMany.mockResolvedValue(doneCodes.map(doneTask) as never)
}

function mockSpawnPlumbing() {
  prismaMock.task.findFirst.mockResolvedValue(null) // chưa có task → cho phép spawn
  prismaMock.task.create.mockImplementation(((args: { data: { templateStepId: string } }) =>
    Promise.resolve({ id: `task-of-${args.data.templateStepId}`, deadline: null })) as never)
  prismaMock.taskAssignee.create.mockResolvedValue({} as never)
  prismaMock.taskHistory.create.mockResolvedValue({} as never)
  prismaMock.user.findFirst.mockResolvedValue({ id: 'u1', fullName: 'Test', isActive: true } as never) // resolveRoleToUser
  prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', fullName: 'Test' } as never)
  prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', fullName: 'Test', telegramChatId: null }] as never)
  prismaMock.project.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'PJ-01', projectName: 'Test' } as never)
  prismaMock.notification.createMany.mockResolvedValue({ count: 1 } as never)
}

function spawnedStepIds(): string[] {
  return prismaMock.task.create.mock.calls.map((c) => (c[0] as { data: { templateStepId: string } }).data.templateStepId)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('chainNextTemplateTasks — gate-driven spawn (template gãy kiểu SX-PROD)', () => {
  it('(i) đủ 4 bước P2.1/P2.2/P2.3/P2.1A DONE → tự spawn P2.4 dù next=[]', async () => {
    mockTemplate(['P1.1', 'P2.1', 'P2.2', 'P2.3', 'P2.1A'])
    mockSpawnPlumbing()

    // P2.1A vừa hoàn thành (next=[] → nhánh next không sinh gì)
    await chainNextTemplateTasks('task-p21a', 'p1', stepByCode.get('P2.1A')!.id, 'u1')

    expect(spawnedStepIds()).toEqual(['step-P2.4'])
    expect(prismaMock.task.create).toHaveBeenCalledTimes(1)
  })

  it('(i) thiếu 1 bước (P2.3 chưa DONE) → KHÔNG spawn P2.4', async () => {
    mockTemplate(['P1.1', 'P2.1', 'P2.2', 'P2.1A']) // thiếu P2.3
    mockSpawnPlumbing()

    await chainNextTemplateTasks('task-p21a', 'p1', stepByCode.get('P2.1A')!.id, 'u1')

    expect(prismaMock.task.create).not.toHaveBeenCalled()
  })

  it('(ii) idempotent: gọi chain 2 lần → P2.4 chỉ được tạo 1 lần', async () => {
    mockTemplate(['P1.1', 'P2.1', 'P2.2', 'P2.3', 'P2.1A'])
    mockSpawnPlumbing()
    // Lần 1: chưa có task P2.4 → spawn. Lần 2: đã có → spawnTemplateStep bỏ qua.
    prismaMock.task.findFirst
      .mockResolvedValueOnce(null as never)
      .mockResolvedValue({ id: 'task-of-step-P2.4' } as never)

    await chainNextTemplateTasks('task-p21a', 'p1', stepByCode.get('P2.1A')!.id, 'u1')
    await chainNextTemplateTasks('task-p21a', 'p1', stepByCode.get('P2.1A')!.id, 'u1')

    expect(prismaMock.task.create).toHaveBeenCalledTimes(1)
    expect(spawnedStepIds()).toEqual(['step-P2.4'])
  })

  it('(iii) P6.5 chỉ spawn khi đủ P6.1-P6.4 DONE', async () => {
    // Thiếu P6.4 → không spawn
    mockTemplate(['P1.1', 'P2.1', 'P2.2', 'P2.3', 'P2.1A', 'P2.4', 'P6.1', 'P6.2', 'P6.3'])
    mockSpawnPlumbing()
    await chainNextTemplateTasks('task-p63', 'p1', stepByCode.get('P6.3')!.id, 'u1')
    expect(prismaMock.task.create).not.toHaveBeenCalled()

    // Đủ P6.1-P6.4 → spawn đúng P6.5 (P2.4 đã DONE → bỏ qua, không spawn lại)
    vi.clearAllMocks()
    mockTemplate(['P1.1', 'P2.1', 'P2.2', 'P2.3', 'P2.1A', 'P2.4', 'P6.1', 'P6.2', 'P6.3', 'P6.4'])
    mockSpawnPlumbing()
    await chainNextTemplateTasks('task-p64', 'p1', stepByCode.get('P6.4')!.id, 'u1')
    expect(spawnedStepIds()).toEqual(['step-P6.5'])
    expect(prismaMock.task.create).toHaveBeenCalledTimes(1)
  })

  it('không projectId hoặc templateStepId → no-op', async () => {
    await chainNextTemplateTasks('t1', null, 'step-P2.4', 'u1')
    await chainNextTemplateTasks('t1', 'p1', null, 'u1')
    expect(prismaMock.templateStep.findMany).not.toHaveBeenCalled()
    expect(prismaMock.task.create).not.toHaveBeenCalled()
  })
})
