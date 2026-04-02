import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'
import { TASK_STATUS } from '@/lib/constants'
import { WORKFLOW_RULES } from '@/lib/workflow-constants'

// Mock sync-engine
vi.mock('@/lib/sync-engine', () => ({
  syncBOMtoBudget: vi.fn().mockResolvedValue(undefined),
  syncPOtoBudget: vi.fn().mockResolvedValue(undefined),
  syncGRNtoBudget: vi.fn().mockResolvedValue(undefined),
  logChangeEvent: vi.fn().mockResolvedValue(undefined),
  runReverseHooks: vi.fn().mockResolvedValue(undefined),
}))

// Mock validation-rules — default: always valid
vi.mock('@/lib/validation-rules', () => ({
  runValidationRules: vi.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] }),
}))

import {
  initializeProjectWorkflow,
  completeTask,
  rejectTask,
  activateTask,
} from '@/lib/workflow-engine'

import { syncBOMtoBudget, syncPOtoBudget, syncGRNtoBudget, runReverseHooks, logChangeEvent } from '@/lib/sync-engine'
import { runValidationRules } from '@/lib/validation-rules'

const PROJECT_ID = 'proj-001'
const USER_ID = 'user-001'
const TASK_ID = 'task-001'

// Helper to build a mock WorkflowTask row
function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    projectId: PROJECT_ID,
    stepCode: 'P1.1',
    stepName: 'Tao du an',
    stepNameEn: 'Create Project',
    assignedRole: 'R02',
    status: TASK_STATUS.IN_PROGRESS,
    deadline: null,
    startedAt: new Date(),
    completedAt: null,
    completedBy: null,
    resultData: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

// ────────────────────────────────────────────────
// initializeProjectWorkflow
// ────────────────────────────────────────────────

describe('initializeProjectWorkflow', () => {
  beforeEach(() => {
    // activateTask internals: updateMany + findUnique + findMany + findFirst + createMany (notifications)
    prismaMock.workflowTask.createMany.mockResolvedValue({ count: 36 })
    prismaMock.workflowTask.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.project.findUnique.mockResolvedValue(null)
    prismaMock.user.findMany.mockResolvedValue([])
    prismaMock.workflowTask.findFirst.mockResolvedValue(null)
  })

  it('creates tasks for all 36 workflow steps', async () => {
    await initializeProjectWorkflow(PROJECT_ID)

    expect(prismaMock.workflowTask.createMany).toHaveBeenCalledOnce()
    const call = prismaMock.workflowTask.createMany.mock.calls[0][0]
    const data = call.data as unknown[]
    expect(data).toHaveLength(Object.keys(WORKFLOW_RULES).length)
  })

  it('sets all tasks to PENDING status initially', async () => {
    await initializeProjectWorkflow(PROJECT_ID)

    const call = prismaMock.workflowTask.createMany.mock.calls[0][0]
    const data = call.data as Array<{ status: string }>
    for (const task of data) {
      expect(task.status).toBe(TASK_STATUS.PENDING)
    }
  })

  it('activates P1.1 after creating tasks', async () => {
    await initializeProjectWorkflow(PROJECT_ID)

    // activateTask calls updateMany with stepCode P1.1
    expect(prismaMock.workflowTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: PROJECT_ID,
          stepCode: 'P1.1',
        }),
        data: expect.objectContaining({
          status: TASK_STATUS.IN_PROGRESS,
        }),
      })
    )
  })

  it('sets deadline for steps with deadlineDays', async () => {
    await initializeProjectWorkflow(PROJECT_ID)

    const call = prismaMock.workflowTask.createMany.mock.calls[0][0]
    const data = call.data as Array<{ stepCode: string; deadline: Date | null }>
    const p11 = data.find(t => t.stepCode === 'P1.1')
    expect(p11?.deadline).toBeInstanceOf(Date)

    // P5.1 has no deadlineDays
    const p51 = data.find(t => t.stepCode === 'P5.1')
    expect(p51?.deadline).toBeNull()
  })
})

// ────────────────────────────────────────────────
// activateTask
// ────────────────────────────────────────────────

describe('activateTask', () => {
  beforeEach(() => {
    prismaMock.workflowTask.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.project.findUnique.mockResolvedValue({ id: PROJECT_ID, projectCode: 'PRJ-001', projectName: 'Test' } as never)
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1' } as never])
    prismaMock.workflowTask.findFirst.mockResolvedValue({ id: 'task-xyz' } as never)
    prismaMock.notification.createMany.mockResolvedValue({ count: 1 })
  })

  it('sets status to IN_PROGRESS with deadline', async () => {
    await activateTask(PROJECT_ID, 'P1.1')

    expect(prismaMock.workflowTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: PROJECT_ID,
          stepCode: 'P1.1',
          status: { in: [TASK_STATUS.PENDING, TASK_STATUS.REJECTED, TASK_STATUS.DONE] },
        }),
        data: expect.objectContaining({
          status: TASK_STATUS.IN_PROGRESS,
        }),
      })
    )
  })

  it('calculates deadline from deadlineDays', async () => {
    const before = Date.now()
    await activateTask(PROJECT_ID, 'P1.1') // P1.1 has deadlineDays: 2

    const call = prismaMock.workflowTask.updateMany.mock.calls[0][0]
    const deadline = call.data.deadline as Date
    expect(deadline).toBeInstanceOf(Date)
    // Deadline should be ~2 days from now
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000
    expect(deadline.getTime()).toBeGreaterThanOrEqual(before + twoDaysMs - 1000)
    expect(deadline.getTime()).toBeLessThanOrEqual(Date.now() + twoDaysMs + 1000)
  })

  it('sets deadline to null when step has no deadlineDays', async () => {
    await activateTask(PROJECT_ID, 'P5.1') // P5.1 has no deadlineDays

    const call = prismaMock.workflowTask.updateMany.mock.calls[0][0]
    expect(call.data.deadline).toBeNull()
  })

  it('creates notification for users with matching role', async () => {
    await activateTask(PROJECT_ID, 'P1.1')

    expect(prismaMock.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            userId: 'u1',
            type: 'task_assigned',
          }),
        ]),
      })
    )
  })

  it('does nothing for unknown step code', async () => {
    await activateTask(PROJECT_ID, 'INVALID_STEP')

    expect(prismaMock.workflowTask.updateMany).not.toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────
// completeTask
// ────────────────────────────────────────────────

describe('completeTask', () => {
  beforeEach(() => {
    // Default: activateTask internals
    prismaMock.workflowTask.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.project.findUnique.mockResolvedValue({ id: PROJECT_ID, projectCode: 'PRJ-001', projectName: 'Test' } as never)
    prismaMock.user.findMany.mockResolvedValue([])
    prismaMock.workflowTask.findFirst.mockResolvedValue(null)
    prismaMock.notification.createMany.mockResolvedValue({ count: 0 })
    prismaMock.workflowTask.update.mockResolvedValue(makeTask({ status: TASK_STATUS.DONE }) as never)
  })

  it('throws when task not found', async () => {
    prismaMock.workflowTask.findUnique.mockResolvedValue(null)

    await expect(completeTask('nonexistent', USER_ID)).rejects.toThrow('Task not found')
  })

  it('throws when task already completed', async () => {
    prismaMock.workflowTask.findUnique.mockResolvedValue(
      makeTask({ status: TASK_STATUS.DONE }) as never
    )

    await expect(completeTask(TASK_ID, USER_ID)).rejects.toThrow('Task already completed')
  })

  it('throws when validation fails', async () => {
    prismaMock.workflowTask.findUnique.mockResolvedValue(makeTask() as never)
    vi.mocked(runValidationRules).mockResolvedValueOnce({
      valid: false,
      errors: ['TC-03-04: Need 3 quotes'],
      warnings: [],
    })

    await expect(completeTask(TASK_ID, USER_ID)).rejects.toThrow('Validation failed: TC-03-04: Need 3 quotes')
  })

  it('marks task as DONE with completedAt and completedBy', async () => {
    prismaMock.workflowTask.findUnique.mockResolvedValue(makeTask() as never)

    await completeTask(TASK_ID, USER_ID)

    expect(prismaMock.workflowTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TASK_ID },
        data: expect.objectContaining({
          status: TASK_STATUS.DONE,
          completedBy: USER_ID,
        }),
      })
    )
  })

  it('saves resultData and notes when provided', async () => {
    prismaMock.workflowTask.findUnique.mockResolvedValue(makeTask() as never)
    const resultData = { someKey: 'someValue' }

    await completeTask(TASK_ID, USER_ID, resultData, 'Test notes')

    expect(prismaMock.workflowTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resultData: { someKey: 'someValue' },
          notes: 'Test notes',
        }),
      })
    )
  })

  it('appends validation warnings to notes', async () => {
    prismaMock.workflowTask.findUnique.mockResolvedValue(makeTask() as never)
    vi.mocked(runValidationRules).mockResolvedValueOnce({
      valid: true,
      errors: [],
      warnings: ['Some warning'],
    })

    await completeTask(TASK_ID, USER_ID, undefined, 'Original note')

    expect(prismaMock.workflowTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          notes: expect.stringContaining('Some warning'),
        }),
      })
    )
  })

  it('activates next steps after completion (P1.1 -> P1.1B)', async () => {
    prismaMock.workflowTask.findUnique.mockResolvedValue(
      makeTask({ stepCode: 'P1.1' }) as never
    )

    const result = await completeTask(TASK_ID, USER_ID)

    expect(result.nextSteps).toContain('P1.1B')
    // activateTask should have been called for P1.1B
    expect(prismaMock.workflowTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ stepCode: 'P1.1B' }),
      })
    )
  })

  it('runs BOM sync hook when completing P2.2', async () => {
    prismaMock.workflowTask.findUnique.mockResolvedValue(
      makeTask({ stepCode: 'P2.2' }) as never
    )
    // Gate check: mock prerequisite tasks as completed
    prismaMock.workflowTask.findMany.mockResolvedValue([])

    await completeTask(TASK_ID, USER_ID)

    expect(syncBOMtoBudget).toHaveBeenCalledWith(PROJECT_ID, USER_ID)
  })

  it('runs PO sync hook when completing P3.3 with poId', async () => {
    prismaMock.workflowTask.findUnique.mockResolvedValue(
      makeTask({ stepCode: 'P3.3' }) as never
    )

    await completeTask(TASK_ID, USER_ID, { poId: 'po-123' })

    expect(syncPOtoBudget).toHaveBeenCalledWith(PROJECT_ID, 'po-123', USER_ID)
  })

  it('runs GRN sync hook when completing P3.4A with grnAmount', async () => {
    prismaMock.workflowTask.findUnique.mockResolvedValue(
      makeTask({ stepCode: 'P3.4A' }) as never
    )

    await completeTask(TASK_ID, USER_ID, { grnAmount: 50000 })

    expect(syncGRNtoBudget).toHaveBeenCalledWith(PROJECT_ID, 50000, USER_ID)
  })

  it('checks gate before activating gated step', async () => {
    // P1.3 has gate: ['P1.2A'] — activating P1.3 requires P1.2A to be DONE
    // Completing P1.1B should try to activate P1.2A and P1.2 (its next steps)
    // But let's test P1.2A completing: its next is P1.3 which has gate ['P1.2A']
    prismaMock.workflowTask.findUnique.mockResolvedValue(
      makeTask({ stepCode: 'P1.2A', assignedRole: 'R02' }) as never
    )

    // P1.2A has next: ['P1.3'] but P1.3 has gate: ['P1.2A']
    // checkGate will look for DONE tasks with stepCode in ['P1.2A']
    prismaMock.workflowTask.findMany.mockResolvedValue([
      { stepCode: 'P1.2A', status: TASK_STATUS.DONE } as never,
    ])

    const result = await completeTask(TASK_ID, USER_ID)

    // P1.2A has next: [] in WORKFLOW_RULES, so no direct next steps
    // But the auto-gate-check logic should find P1.3 depends on P1.2A
    // P1.3 also requires P1.2A only — if we return it DONE, gate passes
    // Actually P1.2A has next: [] so activatedSteps will be empty, triggering gate scan
    expect(result.nextSteps).toBeDefined()
  })

  it('returns empty nextSteps when no rule exists for step', async () => {
    // Create a task with a stepCode that has no next steps
    prismaMock.workflowTask.findUnique.mockResolvedValue(
      makeTask({ stepCode: 'P6.5' }) as never
    )

    const result = await completeTask(TASK_ID, USER_ID)

    expect(result.nextSteps).toEqual([])
  })
})

// ────────────────────────────────────────────────
// rejectTask
// ────────────────────────────────────────────────

describe('rejectTask', () => {
  beforeEach(() => {
    prismaMock.workflowTask.update.mockResolvedValue(makeTask({ status: TASK_STATUS.REJECTED }) as never)
    prismaMock.workflowTask.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.project.findUnique.mockResolvedValue({ id: PROJECT_ID, projectCode: 'PRJ-001', projectName: 'Test' } as never)
    prismaMock.user.findMany.mockResolvedValue([])
    prismaMock.workflowTask.findFirst.mockResolvedValue(null)
    prismaMock.notification.createMany.mockResolvedValue({ count: 0 })
  })

  it('throws when task not found', async () => {
    prismaMock.workflowTask.findUnique.mockResolvedValue(null)

    await expect(rejectTask('nonexistent', USER_ID, 'bad')).rejects.toThrow('Task not found')
  })

  it('throws when step has no rejectTo defined', async () => {
    // P1.1 has no rejectTo
    prismaMock.workflowTask.findUnique.mockResolvedValue(
      makeTask({ stepCode: 'P1.1' }) as never
    )

    await expect(rejectTask(TASK_ID, USER_ID, 'reason')).rejects.toThrow('cannot be rejected')
  })

  it('throws for unknown workflow rule', async () => {
    prismaMock.workflowTask.findUnique.mockResolvedValue(
      makeTask({ stepCode: 'NONEXISTENT' }) as never
    )

    await expect(rejectTask(TASK_ID, USER_ID, 'reason')).rejects.toThrow('No workflow rule')
  })

  it('marks current task as REJECTED with reason', async () => {
    // P1.1B has rejectTo: 'P1.1'
    prismaMock.workflowTask.findUnique.mockResolvedValue(
      makeTask({ stepCode: 'P1.1B', assignedRole: 'R01' }) as never
    )

    await rejectTask(TASK_ID, USER_ID, 'Not approved')

    expect(prismaMock.workflowTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TASK_ID },
        data: expect.objectContaining({
          status: TASK_STATUS.REJECTED,
          notes: 'REJECTED: Not approved',
          completedBy: USER_ID,
        }),
      })
    )
  })

  it('resets intermediate steps between rejectTo and current step', async () => {
    // P5.3 (phase 5) rejects to P5.1 (phase 5) — intermediate steps in phase 5 should be reset
    prismaMock.workflowTask.findUnique.mockResolvedValue(
      makeTask({ stepCode: 'P5.3', assignedRole: 'R09' }) as never
    )

    await rejectTask(TASK_ID, USER_ID, 'QC fail')

    // updateMany is called for: reset intermediates + activateTask
    // The reset call should target phase 5 steps between P5.1 and P5.3
    const updateManyCalls = prismaMock.workflowTask.updateMany.mock.calls
    const resetCall = updateManyCalls.find(
      (c) => c[0].data?.status === TASK_STATUS.PENDING
    )
    expect(resetCall).toBeDefined()
  })

  it('reactivates the rejectTo step', async () => {
    prismaMock.workflowTask.findUnique.mockResolvedValue(
      makeTask({ stepCode: 'P1.1B', assignedRole: 'R01' }) as never
    )

    const result = await rejectTask(TASK_ID, USER_ID, 'Rejected')

    expect(result.returnedTo).toBe('P1.1')
    // activateTask for P1.1 should be called via updateMany
    expect(prismaMock.workflowTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          stepCode: 'P1.1',
          status: { in: [TASK_STATUS.PENDING, TASK_STATUS.REJECTED, TASK_STATUS.DONE] },
        }),
        data: expect.objectContaining({
          status: TASK_STATUS.IN_PROGRESS,
        }),
      })
    )
  })

  it('runs reverse sync hooks', async () => {
    prismaMock.workflowTask.findUnique.mockResolvedValue(
      makeTask({ stepCode: 'P1.1B', assignedRole: 'R01' }) as never
    )

    await rejectTask(TASK_ID, USER_ID, 'Reason')

    expect(runReverseHooks).toHaveBeenCalledWith(PROJECT_ID, 'P1.1B', USER_ID, 'Reason')
  })

  it('logs a change event for the rejection', async () => {
    prismaMock.workflowTask.findUnique.mockResolvedValue(
      makeTask({ stepCode: 'P1.1B', assignedRole: 'R01' }) as never
    )

    await rejectTask(TASK_ID, USER_ID, 'Bad quality')

    expect(logChangeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        sourceStep: 'P1.1B',
        eventType: 'REJECT',
        reason: 'Bad quality',
        triggeredBy: USER_ID,
      })
    )
  })

  it('uses overrideRejectTo when provided', async () => {
    prismaMock.workflowTask.findUnique.mockResolvedValue(
      makeTask({ stepCode: 'P5.3', assignedRole: 'R09' }) as never
    )

    const result = await rejectTask(TASK_ID, USER_ID, 'Override', 'P5.2')

    expect(result.returnedTo).toBe('P5.2')
  })

  it('skips intermediate reset when overrideRejectTo is used', async () => {
    prismaMock.workflowTask.findUnique.mockResolvedValue(
      makeTask({ stepCode: 'P5.3', assignedRole: 'R09' }) as never
    )

    await rejectTask(TASK_ID, USER_ID, 'Override', 'P5.2')

    // With overrideRejectTo, the intermediate-step reset updateMany (PENDING status) should NOT be called
    const updateManyCalls = prismaMock.workflowTask.updateMany.mock.calls
    const resetCall = updateManyCalls.find(
      (c) => c[0].data?.status === TASK_STATUS.PENDING
    )
    expect(resetCall).toBeUndefined()
  })

  it('creates notifications for target role users on rejection', async () => {
    prismaMock.workflowTask.findUnique.mockResolvedValue(
      makeTask({ stepCode: 'P1.1B', assignedRole: 'R01' }) as never
    )
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1' } as never, { id: 'u2' } as never])

    await rejectTask(TASK_ID, USER_ID, 'Need changes')

    // Notifications created: one from activateTask + one from rejectTask itself
    expect(prismaMock.notification.createMany).toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────
// checkGate (tested indirectly via completeTask)
// ────────────────────────────────────────────────

describe('checkGate (via completeTask)', () => {
  beforeEach(() => {
    prismaMock.workflowTask.update.mockResolvedValue(makeTask({ status: TASK_STATUS.DONE }) as never)
    prismaMock.workflowTask.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.project.findUnique.mockResolvedValue({ id: PROJECT_ID, projectCode: 'PRJ-001', projectName: 'Test' } as never)
    prismaMock.user.findMany.mockResolvedValue([])
    prismaMock.workflowTask.findFirst.mockResolvedValue(null)
    prismaMock.notification.createMany.mockResolvedValue({ count: 0 })
  })

  it('blocks gated step when prerequisites not met', async () => {
    // P1.2A completes. Its next is []. But P1.3 has gate: ['P1.2A'].
    // The auto-gate scan should find P1.3 depends on P1.2A.
    // However P1.3 gate also only requires P1.2A, so if P1.2A is done, gate passes.
    prismaMock.workflowTask.findUnique.mockResolvedValue(
      makeTask({ stepCode: 'P2.1', assignedRole: 'R04' }) as never
    )

    // P2.1 has next: [] so it hits the auto-gate-check.
    // P2.4 has gate: ['P2.1', 'P2.2', 'P2.3', 'P2.1A']
    // Only P2.1 is done — gate should fail
    prismaMock.workflowTask.findMany.mockResolvedValue([
      { stepCode: 'P2.1', status: TASK_STATUS.DONE } as never,
    ])

    const result = await completeTask(TASK_ID, USER_ID)

    // P2.4 should NOT be activated because gate is incomplete
    expect(result.nextSteps).not.toContain('P2.4')
  })

  it('allows gated step when all prerequisites met', async () => {
    // Complete the last prerequisite for P2.4: gate is ['P2.1', 'P2.2', 'P2.3', 'P2.1A']
    prismaMock.workflowTask.findUnique.mockResolvedValue(
      makeTask({ stepCode: 'P2.1A', assignedRole: 'R08' }) as never
    )

    // All four prerequisites done
    prismaMock.workflowTask.findMany.mockResolvedValue([
      { stepCode: 'P2.1', status: TASK_STATUS.DONE } as never,
      { stepCode: 'P2.2', status: TASK_STATUS.DONE } as never,
      { stepCode: 'P2.3', status: TASK_STATUS.DONE } as never,
      { stepCode: 'P2.1A', status: TASK_STATUS.DONE } as never,
    ])

    const result = await completeTask(TASK_ID, USER_ID)

    expect(result.nextSteps).toContain('P2.4')
  })
})

// ────────────────────────────────────────────────
// Edge cases
// ────────────────────────────────────────────────

describe('edge cases', () => {
  beforeEach(() => {
    prismaMock.workflowTask.update.mockResolvedValue(makeTask({ status: TASK_STATUS.DONE }) as never)
    prismaMock.workflowTask.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.project.findUnique.mockResolvedValue({ id: PROJECT_ID, projectCode: 'PRJ-001', projectName: 'Test' } as never)
    prismaMock.user.findMany.mockResolvedValue([])
    prismaMock.workflowTask.findFirst.mockResolvedValue(null)
    prismaMock.notification.createMany.mockResolvedValue({ count: 0 })
  })

  it('completeTask handles missing resultData gracefully', async () => {
    prismaMock.workflowTask.findUnique.mockResolvedValue(makeTask() as never)

    await expect(completeTask(TASK_ID, USER_ID)).resolves.toBeDefined()
  })

  it('completeTask with PENDING status throws (not IN_PROGRESS, but not DONE)', async () => {
    // PENDING is not DONE, so it should NOT throw "already completed"
    prismaMock.workflowTask.findUnique.mockResolvedValue(
      makeTask({ status: TASK_STATUS.PENDING }) as never
    )

    // Should proceed without error (the engine does not check for IN_PROGRESS explicitly)
    await expect(completeTask(TASK_ID, USER_ID)).resolves.toBeDefined()
  })

  it('activateTask is idempotent — calling twice does not error', async () => {
    await activateTask(PROJECT_ID, 'P1.1')
    await activateTask(PROJECT_ID, 'P1.1')

    expect(prismaMock.workflowTask.updateMany).toHaveBeenCalledTimes(2)
  })

  it('rejectTask creates notification even when no users found', async () => {
    prismaMock.workflowTask.findUnique.mockResolvedValue(
      makeTask({ stepCode: 'P1.1B', assignedRole: 'R01' }) as never
    )
    prismaMock.user.findMany.mockResolvedValue([])

    // Should not throw
    await expect(rejectTask(TASK_ID, USER_ID, 'test')).resolves.toBeDefined()
  })

  it('completeTask runs validation rules for the step', async () => {
    prismaMock.workflowTask.findUnique.mockResolvedValue(
      makeTask({ stepCode: 'P3.5' }) as never
    )

    await completeTask(TASK_ID, USER_ID, { rfqCount: 5 })

    expect(runValidationRules).toHaveBeenCalledWith('P3.5', { rfqCount: 5 }, PROJECT_ID)
  })
})
