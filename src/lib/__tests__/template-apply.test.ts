import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'

vi.mock('@/lib/db', () => ({ default: prismaMock }))
vi.mock('@/lib/telegram', () => ({ sendGroupMessage: vi.fn(), escapeHtml: (s: string) => s }))

import { applyTemplate, listTemplates } from '@/lib/work-engine'

const TPL_ID = 'tpl-1'

function mkStep(code: string, orderIndex: number, nextCodes: string[] = [], gateCodes: string[] = [], role = 'R02') {
  return {
    id: `step-${code}`, templateId: TPL_ID, code, title: `Step ${code}`,
    roleCode: role, deptCode: null, orderIndex, deadlineDays: null,
    taskType: code, hookKeys: [], nextCodes, gateCodes, parentCode: null,
  }
}

const STEPS_LINEAR = [
  mkStep('S1', 0, ['S2']),
  mkStep('S2', 1, ['S3'], ['S1']),
  mkStep('S3', 2, [], ['S2']),
]

const STEPS_PARALLEL_ENTRY = [
  mkStep('A', 0, ['C'], []),
  mkStep('B', 1, ['C'], []),
  mkStep('C', 2, [], ['A', 'B']),
]

const TPL = {
  id: TPL_ID, code: 'TPL-TEST', name: 'Test Template', projectType: 'EXTERNAL_PROD',
  productType: null, version: 1, isActive: true,
  createdAt: new Date(), updatedAt: new Date(),
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', fullName: 'Test' } as never)
  prismaMock.project.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'P-TEST', projectName: 'Test' } as never)
  prismaMock.taskAssignee.create.mockResolvedValue({} as never)
  prismaMock.taskHistory.create.mockResolvedValue({} as never)
})

function mockResolveRole() {
  prismaMock.taskAssignee.findFirst.mockResolvedValue(null)
  prismaMock.user.findFirst.mockResolvedValue({ id: 'u1', fullName: 'Test', roleCode: 'R02' } as never)
  prismaMock.user.findMany.mockResolvedValue([{ id: 'u1' }] as never)
  prismaMock.notification.createMany.mockResolvedValue({ count: 0 } as never)
}

// Mock "DB thật": store task có trạng thái, task.create ghi vào store,
// task.findMany/findFirst đọc từ store. Bắt buộc để test THỨ TỰ spawn trong
// applyTemplate — mock tĩnh không thấy được task vừa spawn nên legacy grace
// của doneCodesForProject không bao giờ tắt (che mất bug P1.1B sinh sớm).
function statefulTaskStore(initial: { templateStepId: string; status: string }[] = []) {
  const store = [...initial]
  prismaMock.task.findMany.mockImplementation((() => Promise.resolve(store)) as never)
  prismaMock.task.findFirst.mockImplementation(((args: { where: { templateStepId?: string } }) =>
    Promise.resolve(store.find((t) => t.templateStepId === args.where.templateStepId) ?? null)) as never)
  prismaMock.task.create.mockImplementation(((args: { data: { templateStepId: string } }) => {
    store.push({ templateStepId: args.data.templateStepId, status: 'OPEN' })
    return Promise.resolve({ id: `task-of-${args.data.templateStepId}`, deadline: null })
  }) as never)
  return store
}

function spawnedStepIds(): string[] {
  return prismaMock.task.create.mock.calls.map((c) => (c[0] as { data: { templateStepId: string } }).data.templateStepId)
}

describe('applyTemplate', () => {
  it('spawns ONLY entry step on empty project (linear) — no premature chain', async () => {
    prismaMock.workflowTemplate.findFirst.mockResolvedValue({ ...TPL, steps: STEPS_LINEAR } as never)
    statefulTaskStore() // dự án trống, DB phản ánh task vừa spawn
    mockResolveRole()

    const result = await applyTemplate('p1', 'TPL-TEST', 'u1')
    expect(result.ok).toBe(true)
    // S1 là entry (không nằm trong nextCodes của ai) + không gate → spawn.
    // Sau khi S1 spawn, legacy grace TẮT → done-set rỗng → S2 (gate [S1]) KHÔNG
    // được sinh sớm (bug cũ: done-set tính trước spawn → grace coi S1 đã xong → sinh S2).
    expect(result.created).toBe(1)
    expect(spawnedStepIds()).toEqual(['step-S1'])
  })

  it('spawns parallel entry steps (A and B) on empty project', async () => {
    prismaMock.workflowTemplate.findFirst.mockResolvedValue({ ...TPL, steps: STEPS_PARALLEL_ENTRY } as never)
    prismaMock.task.findMany.mockResolvedValue([]) // no template tasks
    prismaMock.task.findFirst.mockResolvedValue(null) // not yet spawned
    prismaMock.task.create.mockResolvedValue({ id: 'new-1', deadline: null } as never)
    mockResolveRole()

    const result = await applyTemplate('p1', 'TPL-TEST', 'u1')
    expect(result.ok).toBe(true)
    // A and B are both entry steps (not in anyone's nextCodes) + ungated
    expect(result.created).toBe(2)
  })

  it('idempotent: second apply creates 0 tasks', async () => {
    prismaMock.workflowTemplate.findFirst.mockResolvedValue({ ...TPL, steps: STEPS_PARALLEL_ENTRY } as never)
    prismaMock.task.findMany.mockResolvedValue([]) // no DONE tasks
    // spawnTemplateStep finds existing → returns false
    prismaMock.task.findFirst.mockResolvedValue({ id: 'existing' } as never)

    const result = await applyTemplate('p1', 'TPL-TEST', 'u1')
    expect(result.ok).toBe(true)
    expect(result.created).toBe(0)
  })

  it('LEGACY: root spawned + DONE → done via status, chain works', async () => {
    prismaMock.workflowTemplate.findFirst.mockResolvedValue({ ...TPL, steps: STEPS_LINEAR } as never)
    // Root S1 spawned and DONE
    prismaMock.task.findMany.mockResolvedValue([
      { templateStepId: 'step-S1', status: 'DONE' },
    ] as never)
    // S1 already spawned, S2 not yet
    prismaMock.task.findFirst
      .mockResolvedValueOnce({ id: 'existing-s1' } as never) // S1 exists (entry check)
      .mockResolvedValueOnce(null as never) // S2 not yet spawned
    prismaMock.task.create.mockResolvedValue({ id: 'new-s2', deadline: null } as never)
    mockResolveRole()

    const result = await applyTemplate('p1', 'TPL-TEST', 'u1')
    expect(result.ok).toBe(true)
    // S1 entry but already exists → 0. Chain from S1 done → S2 gate [S1] met → spawned
    expect(result.created).toBe(1)
  })

  it('LEGACY: root spawned but NOT done → root not auto-done', async () => {
    prismaMock.workflowTemplate.findFirst.mockResolvedValue({ ...TPL, steps: STEPS_LINEAR } as never)
    // Root S1 spawned but IN_PROGRESS
    prismaMock.task.findMany.mockResolvedValue([
      { templateStepId: 'step-S1', status: 'IN_PROGRESS' },
    ] as never)
    prismaMock.task.findFirst.mockResolvedValue({ id: 'existing-s1' } as never)

    const result = await applyTemplate('p1', 'TPL-TEST', 'u1')
    expect(result.ok).toBe(true)
    // S1 entry exists → 0. S1 not DONE → no chain → 0
    expect(result.created).toBe(0)
  })

  it('completes entry → chain spawns gated step', async () => {
    prismaMock.workflowTemplate.findFirst.mockResolvedValue({ ...TPL, steps: STEPS_PARALLEL_ENTRY } as never)
    // Both A and B DONE
    prismaMock.task.findMany.mockResolvedValue([
      { templateStepId: 'step-A', status: 'DONE' },
      { templateStepId: 'step-B', status: 'DONE' },
    ] as never)
    prismaMock.task.findFirst
      .mockResolvedValueOnce({ id: 'existing-a' } as never) // A exists (entry check)
      .mockResolvedValueOnce({ id: 'existing-b' } as never) // B exists (entry check)
      .mockResolvedValueOnce(null as never) // C not yet (from A's chain)
      .mockResolvedValueOnce({ id: 'new-c' } as never) // C already created (from B's chain — idempotent)
    prismaMock.task.create.mockResolvedValue({ id: 'new-c', deadline: null } as never)
    mockResolveRole()

    const result = await applyTemplate('p1', 'TPL-TEST', 'u1')
    expect(result.ok).toBe(true)
    // A, B entries exist → 0. Chain: A→C spawned (1), B→C idempotent (0)
    expect(result.created).toBe(1)
  })
})

// ── Regression bug prod: dự án MỚI áp template SX-PROD sinh cả P1.1B ngày 1 ──
// Nguyên nhân: applyTemplate gọi doneCodesForProject TRƯỚC khi spawn entry P1.1
// → root chưa có task → legacy grace coi P1.1 "đã xong" → pass chain sinh P1.1B ngay.
// Fix: spawn entries TRƯỚC, tính done-set SAU (grace tắt vì root đã spawn).
describe('applyTemplate — thứ tự spawn entry trước done-set (fix P1.1B ngày 1)', () => {
  const STEPS_P1 = [
    mkStep('P1.1', 0, ['P1.1B']),
    mkStep('P1.1B', 1, ['P1.2A', 'P1.2'], ['P1.1']),
    mkStep('P1.2A', 2, [], ['P1.1B']),
    mkStep('P1.2', 3, [], ['P1.1B']),
  ]

  it('(i) dự án TRỐNG áp template → CHỈ P1.1 spawn, KHÔNG P1.1B', async () => {
    prismaMock.workflowTemplate.findFirst.mockResolvedValue({ ...TPL, steps: STEPS_P1 } as never)
    statefulTaskStore()
    mockResolveRole()

    const result = await applyTemplate('p1', 'TPL-TEST', 'u1')
    expect(result.ok).toBe(true)
    expect(result.created).toBe(1)
    expect(spawnedStepIds()).toEqual(['step-P1.1']) // P1.1B/P1.2A/P1.2 KHÔNG sinh sớm
  })

  it('(ii) re-apply: dự án đã có P1.1 DONE → P1.1B được bổ sung đúng gate', async () => {
    prismaMock.workflowTemplate.findFirst.mockResolvedValue({ ...TPL, steps: STEPS_P1 } as never)
    // Dự án cũ: P1.1 đã spawn và DONE thật → grace tắt, done-set = {P1.1}
    statefulTaskStore([{ templateStepId: 'step-P1.1', status: 'DONE' }])
    mockResolveRole()

    const result = await applyTemplate('p1', 'TPL-TEST', 'u1')
    expect(result.ok).toBe(true)
    // Entry P1.1 đã tồn tại → 0. Chain P1.1 done → P1.1B (gate [P1.1] thỏa) → 1.
    // P1.2A/P1.2 gate [P1.1B] chưa DONE → không sinh.
    expect(result.created).toBe(1)
    expect(spawnedStepIds()).toEqual(['step-P1.1B'])
  })

  it('(iii) idempotent: áp 2 lần trên dự án trống → lần 2 tạo 0, tổng vẫn chỉ P1.1', async () => {
    prismaMock.workflowTemplate.findFirst.mockResolvedValue({ ...TPL, steps: STEPS_P1 } as never)
    statefulTaskStore()
    mockResolveRole()

    const r1 = await applyTemplate('p1', 'TPL-TEST', 'u1')
    const r2 = await applyTemplate('p1', 'TPL-TEST', 'u1')
    expect(r1.created).toBe(1)
    expect(r2.created).toBe(0) // spawnTemplateStep idempotent + grace vẫn tắt
    expect(spawnedStepIds()).toEqual(['step-P1.1'])
  })

  it('(iii) idempotent: re-apply 2 lần trên dự án có P1.1 DONE → P1.1B chỉ tạo 1 lần', async () => {
    prismaMock.workflowTemplate.findFirst.mockResolvedValue({ ...TPL, steps: STEPS_P1 } as never)
    statefulTaskStore([{ templateStepId: 'step-P1.1', status: 'DONE' }])
    mockResolveRole()

    const r1 = await applyTemplate('p1', 'TPL-TEST', 'u1')
    const r2 = await applyTemplate('p1', 'TPL-TEST', 'u1')
    expect(r1.created).toBe(1)
    expect(r2.created).toBe(0)
    expect(spawnedStepIds()).toEqual(['step-P1.1B'])
  })
})

describe('listTemplates — productType', () => {
  it('returns productType field', async () => {
    prismaMock.workflowTemplate.findMany.mockResolvedValue([
      { ...TPL, productType: 'pressure_vessel', _count: { steps: 5 } },
      { ...TPL, id: 'tpl-2', code: 'SX-PROD', productType: null, _count: { steps: 32 } },
    ] as never)

    const result = await listTemplates()
    expect(result[0].productType).toBe('pressure_vessel')
    expect(result[1].productType).toBeNull()
  })

  it('fallback: generic template has null productType', async () => {
    prismaMock.workflowTemplate.findMany.mockResolvedValue([
      { ...TPL, code: 'SX-PROD', productType: null, _count: { steps: 32 } },
    ] as never)

    const result = await listTemplates()
    const generic = result.find(t => !t.productType)
    expect(generic).toBeDefined()
    expect(generic!.productType).toBeNull()
  })
})
