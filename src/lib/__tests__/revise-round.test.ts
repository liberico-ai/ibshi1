/**
 * Revise Flow36 · Phase 1a — bộ test đóng đinh T1-T6 (DESIGN_C1 2.4).
 * T1 chống PASS-NHẦM là chốt chặn cả model. T5 kiểm expand fixpoint đồ-thị-hợp.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'

vi.mock('@/lib/db', () => ({ default: prismaMock }))
vi.mock('@/lib/telegram', () => ({ sendGroupMessage: vi.fn(), escapeHtml: (s: string) => s, formatDeadline: () => '' }))

import { openRevisionRound, chainNextTemplateTasks } from '@/lib/work-engine'
import { expandRevisionRound, orphanFeeders, reverseBfsInclGate } from '@/lib/revise-engine'

const TPL_ID = 'tpl-sxprod'
const PID = 'p1'

function mkStep(code: string, orderIndex: number, nextCodes: string[] = [], gateCodes: string[] = [], role = 'R02') {
  return {
    id: `step-${code}`, templateId: TPL_ID, code, title: `Step ${code}`,
    roleCode: role, deptCode: null, orderIndex, deadlineDays: null,
    taskType: code, hookKeys: [], nextCodes, gateCodes, parentCode: null,
  }
}

// Fixture khớp topology SX-PROD phần liên quan:
// P1.1→P1.2→P1.3→(P2.1|P2.2|P2.3|P2.1A song song) → P2.4(gate 4) → P2.5 → (P3.1|P3.3|P3.4) ; P3.1→P3.5
const STEPS = [
  mkStep('P1.1', 0, ['P1.2']),
  mkStep('P1.2', 1, ['P1.3']),
  mkStep('P1.3', 2, ['P2.1', 'P2.2', 'P2.3', 'P2.1A']),
  mkStep('P2.1', 3, []),
  mkStep('P2.2', 4, []),
  mkStep('P2.3', 5, []),
  mkStep('P2.1A', 6, []),
  mkStep('P2.4', 7, ['P2.5'], ['P2.1', 'P2.2', 'P2.3', 'P2.1A'], 'R03'),
  mkStep('P2.5', 8, ['P3.1', 'P3.3', 'P3.4']),
  mkStep('P3.1', 9, ['P3.5']),
  mkStep('P3.3', 10, []),
  mkStep('P3.4', 11, []),
  mkStep('P3.5', 12, []),
]

// ── Stateful store mock (spawn → resolve → chain) ──
interface StoreTask { id: string; projectId: string; templateStepId: string | null; revisionRound: number; status: string; originStepCode: string | null; revisionId: string | null }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matchTask(t: StoreTask, where: any): boolean {
  if (!where) return true
  if (where.projectId !== undefined && t.projectId !== where.projectId) return false
  if (typeof where.templateStepId === 'string' && t.templateStepId !== where.templateStepId) return false
  if (where.revisionRound !== undefined && t.revisionRound !== where.revisionRound) return false
  if (where.NOT?.templateStepId === null && (t.templateStepId === null || t.templateStepId === undefined)) return false
  if (where.NOT?.originStepCode === null && (t.originStepCode === null || t.originStepCode === undefined)) return false
  return true
}

function setup(seedRound0AllDone: boolean) {
  const store: StoreTask[] = []
  let idc = 0
  if (seedRound0AllDone) {
    for (const s of STEPS) store.push({ id: `t0-${s.code}`, projectId: PID, templateStepId: s.id, revisionRound: 0, status: 'DONE', originStepCode: null, revisionId: null })
  }
  prismaMock.templateStep.findUnique.mockImplementation(((a: { where: { id: string } }) =>
    Promise.resolve(STEPS.find((s) => s.id === a.where.id) || null)) as never)
  prismaMock.templateStep.findMany.mockResolvedValue(STEPS as never)
  prismaMock.workflowTemplate.findFirst.mockResolvedValue({ id: TPL_ID } as never)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prismaMock.task.findFirst.mockImplementation(((a: any) => Promise.resolve(store.find((t) => matchTask(t, a?.where)) || null)) as never)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prismaMock.task.findMany.mockImplementation(((a: any) => Promise.resolve(store.filter((t) => matchTask(t, a?.where)))) as never)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prismaMock.task.create.mockImplementation(((a: any) => {
    const t: StoreTask = {
      id: `t${++idc}`, projectId: a.data.projectId, templateStepId: a.data.templateStepId,
      revisionRound: a.data.revisionRound ?? 0, status: a.data.status ?? 'OPEN',
      originStepCode: a.data.originStepCode ?? null, revisionId: a.data.revisionId ?? null,
    }
    store.push(t)
    return Promise.resolve({ ...t, deadline: null })
  }) as never)
  // plumbing
  prismaMock.taskAssignee.create.mockResolvedValue({} as never)
  prismaMock.taskHistory.create.mockResolvedValue({} as never)
  prismaMock.user.findFirst.mockResolvedValue({ id: 'u1', fullName: 'Test', isActive: true } as never)
  prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', fullName: 'Test' } as never)
  prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', fullName: 'Test', telegramChatId: null }] as never)
  prismaMock.project.findUnique.mockResolvedValue({ id: PID, projectCode: 'PJ-01', projectName: 'Test' } as never)
  prismaMock.notification.createMany.mockResolvedValue({ count: 1 } as never)

  const count = (code: string, round: number) => store.filter((t) => t.templateStepId === `step-${code}` && t.revisionRound === round).length
  const setStatus = (code: string, round: number, status: string) => {
    const t = store.find((x) => x.templateStepId === `step-${code}` && x.revisionRound === round)
    if (t) t.status = status
    return t
  }
  const resolveAndChain = async (code: string, round: number, status = 'DONE') => {
    const t = setStatus(code, round, status)
    await chainNextTemplateTasks(t?.id ?? 'x', PID, `step-${code}`, 'u1', round)
  }
  return { store, count, setStatus, resolveAndChain }
}

beforeEach(() => { vi.clearAllMocks() })

// ══════════════════ PURE (T5) — expand fixpoint đồ-thị-hợp ══════════════════
describe('T5 — expandRevisionRound (fixpoint đồ-thị-hợp)', () => {
  it('T5: expand(P2.1) ⊇ frontier hạ nguồn, ∌ P1.x', () => {
    const r = expandRevisionRound(STEPS, 'P2.1')
    for (const c of ['P2.1', 'P2.2', 'P2.3', 'P2.1A', 'P2.4', 'P2.5', 'P3.1', 'P3.3', 'P3.4', 'P3.5']) {
      expect(r.has(c), `thiếu ${c}`).toBe(true)
    }
    for (const c of ['P1.1', 'P1.2', 'P1.3']) expect(r.has(c), `KHÔNG được có ${c}`).toBe(false)
  })

  it('T5b: feeder có nhánh next riêng → fixpoint phủ (a chạy lại)', () => {
    const S = [
      mkStep('E', 0, []),
      mkStep('F1', 1, ['X']),                 // feeder của G, có next riêng
      mkStep('X', 2, []),
      mkStep('G', 3, [], ['E', 'F1']),        // gate lồng E,F1
    ]
    const r = expandRevisionRound(S, 'E')
    expect(r.has('G')).toBe(true)             // (b) feeder→gate
    expect(r.has('F1')).toBe(true)            // (c) kéo feeder song song
    expect(r.has('X')).toBe(true)             // (a) next của feeder vừa add
  })

  it('T5c: gate lồng nhiều tầng → fixpoint phủ hết', () => {
    const S = [
      mkStep('E', 0, []),
      mkStep('Y', 1, []),
      mkStep('X', 2, [], ['Y']),              // gate-step, feeder Y
      mkStep('G2', 3, [], ['E', 'X']),        // gate-step, feeder X (là gate-step)
    ]
    const r = expandRevisionRound(S, 'E')
    expect(r.has('G2')).toBe(true)
    expect(r.has('X')).toBe(true)             // feeder tầng 1
    expect(r.has('Y')).toBe(true)             // feeder tầng 2 (gate lồng)
  })

  it('orphanFeeders(P2.1) = anh-em song song {P2.2,P2.3,P2.1A}; ∌ P2.4 (gate-step)', () => {
    const reached = expandRevisionRound(STEPS, 'P2.1')
    const orphans = orphanFeeders(STEPS, 'P2.1', reached).sort()
    expect(orphans).toEqual(['P2.1A', 'P2.2', 'P2.3'])
    expect(orphans).not.toContain('P2.4')
    expect(orphans).not.toContain('P2.5')
  })

  it('reverseBfsInclGate(P2.1) = tổ tiên P1.x (∌ anh-em song song)', () => {
    const anc = reverseBfsInclGate('P2.1', STEPS)
    expect([...anc].sort()).toEqual(['P1.1', 'P1.2', 'P1.3'])
    expect(anc.has('P2.2')).toBe(false)
  })
})

// ══════════════════ STATEFUL (T1-T4, T6) ══════════════════
describe('T1 — chống PASS-NHẦM (quan trọng nhất)', () => {
  it('open P2.1 round-1: P2.4 round-1 KHÔNG spawn tới khi P2.1+3 sibling round-1 resolved', async () => {
    const h = setup(true) // round-0 DONE hết
    const res = await openRevisionRound(PID, 'P2.1', 1, 'u1', { templateCode: 'SX-PROD' })

    // Chỉ spawn entry + orphan-feeder; KHÔNG spawn P2.4/P2.5
    expect(res.spawned.sort()).toEqual(['P2.1', 'P2.1A', 'P2.2', 'P2.3'])
    expect(h.count('P2.4', 1)).toBe(0)       // ← chốt chặn pass-nhầm
    expect(h.count('P2.5', 1)).toBe(0)

    // Resolve dần — P2.4 vẫn KHÔNG spawn khi còn thiếu feeder round-1
    await h.resolveAndChain('P2.1', 1)
    expect(h.count('P2.4', 1)).toBe(0)
    await h.resolveAndChain('P2.2', 1)
    await h.resolveAndChain('P2.3', 1)
    expect(h.count('P2.4', 1)).toBe(0)       // vẫn thiếu P2.1A

    // Đủ 4 feeder round-1 resolved → P2.4 round-1 mới spawn
    await h.resolveAndChain('P2.1A', 1)
    expect(h.count('P2.4', 1)).toBe(1)
  })
})

describe('T2 — no-deadlock khi sibling SKIPPED', () => {
  it('P2.2/P2.3/P2.1A round-1 = SKIPPED_NO_IMPACT, P2.1 = DONE → P2.4 round-1 spawn', async () => {
    const h = setup(true)
    await openRevisionRound(PID, 'P2.1', 1, 'u1', { templateCode: 'SX-PROD' })
    await h.resolveAndChain('P2.2', 1, 'SKIPPED_NO_IMPACT')
    await h.resolveAndChain('P2.3', 1, 'SKIPPED_NO_IMPACT')
    await h.resolveAndChain('P2.1A', 1, 'SKIPPED_NO_IMPACT')
    expect(h.count('P2.4', 1)).toBe(0)       // còn P2.1 chưa xong
    await h.resolveAndChain('P2.1', 1, 'DONE')
    expect(h.count('P2.4', 1)).toBe(1)       // skip = resolved → gate thoả
  })
})

describe('T3 — round isolation', () => {
  it('open/chạy round-1 KHÔNG đổi task round-0', async () => {
    const h = setup(true)
    const before = h.store.filter((t) => t.revisionRound === 0).map((t) => `${t.templateStepId}:${t.status}`).sort()
    await openRevisionRound(PID, 'P2.1', 1, 'u1', { templateCode: 'SX-PROD' })
    await h.resolveAndChain('P2.1', 1)
    const after = h.store.filter((t) => t.revisionRound === 0).map((t) => `${t.templateStepId}:${t.status}`).sort()
    expect(after).toEqual(before)            // round-0 bất biến
    expect(h.count('P2.1', 0)).toBe(1)       // không nhân đôi
    expect(h.count('P2.1', 1)).toBe(1)
  })
})

describe('T4 — dedup (templateStepId, revisionRound)', () => {
  it('open round-1 idempotent; round-0 vs round-1 phân biệt', async () => {
    const h = setup(true)
    const r1 = await openRevisionRound(PID, 'P2.1', 1, 'u1', { templateCode: 'SX-PROD' })
    const r2 = await openRevisionRound(PID, 'P2.1', 1, 'u1', { templateCode: 'SX-PROD' })
    expect(r1.spawned.length).toBe(4)
    expect(r2.spawned.length).toBe(0)        // idempotent — không nhân đôi
    expect(h.count('P2.1', 1)).toBe(1)
    expect(h.count('P2.1', 0)).toBe(1)       // round-0 seed vẫn tồn tại, tách biệt
  })
})

describe('T6 — kế thừa tổ tiên round-0', () => {
  it('entry giữa chuỗi: gate hạ nguồn cần tổ tiên → thoả nhờ round-0', async () => {
    // Fixture riêng: A→B→C ; C.gate=[A] (A là tổ tiên của entry B)
    const T6 = [mkStep('A', 0, ['B']), mkStep('B', 1, ['C']), mkStep('C', 2, [], ['A'])]
    const store: StoreTask[] = [{ id: 't0-A', projectId: PID, templateStepId: 'step-A', revisionRound: 0, status: 'DONE', originStepCode: null, revisionId: null }]
    let idc = 0
    prismaMock.templateStep.findUnique.mockImplementation(((a: { where: { id: string } }) => Promise.resolve(T6.find((s) => s.id === a.where.id) || null)) as never)
    prismaMock.templateStep.findMany.mockResolvedValue(T6 as never)
    prismaMock.workflowTemplate.findFirst.mockResolvedValue({ id: TPL_ID } as never)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaMock.task.findFirst.mockImplementation(((a: any) => Promise.resolve(store.find((t) => matchTask(t, a?.where)) || null)) as never)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaMock.task.findMany.mockImplementation(((a: any) => Promise.resolve(store.filter((t) => matchTask(t, a?.where)))) as never)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaMock.task.create.mockImplementation(((a: any) => { const t: StoreTask = { id: `t${++idc}`, projectId: a.data.projectId, templateStepId: a.data.templateStepId, revisionRound: a.data.revisionRound ?? 0, status: a.data.status ?? 'OPEN', originStepCode: a.data.originStepCode ?? null, revisionId: a.data.revisionId ?? null }; store.push(t); return Promise.resolve({ ...t, deadline: null }) }) as never)
    prismaMock.taskAssignee.create.mockResolvedValue({} as never)
    prismaMock.taskHistory.create.mockResolvedValue({} as never)
    prismaMock.user.findFirst.mockResolvedValue({ id: 'u1', fullName: 'T', isActive: true } as never)
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', fullName: 'T' } as never)
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', fullName: 'T', telegramChatId: null }] as never)
    prismaMock.project.findUnique.mockResolvedValue({ id: PID, projectCode: 'PJ', projectName: 'T' } as never)
    prismaMock.notification.createMany.mockResolvedValue({ count: 1 } as never)

    await openRevisionRound(PID, 'B', 1, 'u1', { templateCode: 'SX-PROD' })
    // Resolve B round-1 → chain: C.gate=[A], A là tổ tiên (round-0 DONE) → C round-1 spawn
    const b = store.find((t) => t.templateStepId === 'step-B' && t.revisionRound === 1)!
    b.status = 'DONE'
    await chainNextTemplateTasks(b.id, PID, 'step-B', 'u1', 1)
    expect(store.filter((t) => t.templateStepId === 'step-C' && t.revisionRound === 1).length).toBe(1)
  })
})
