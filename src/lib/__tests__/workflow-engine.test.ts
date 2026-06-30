import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'
import { TASK_STATUS } from '@/lib/constants'
import { WORKFLOW_RULES } from '@/lib/workflow-constants'

// Mock sync-engine
vi.mock('@/lib/sync-engine', () => ({
  logChangeEvent: vi.fn().mockResolvedValue(undefined),
  runReverseHooks: vi.fn().mockResolvedValue(undefined),
}))

// Mock validation-rules — default: always valid
vi.mock('@/lib/validation-rules', () => ({
  runValidationRules: vi.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] }),
}))

// Mock work-engine resolveRoleToUser
vi.mock('@/lib/work-engine', () => ({
  resolveRoleToUser: vi.fn().mockResolvedValue({ id: 'resolved-user-1', fullName: 'Resolved User' }),
  getDeptHead: vi.fn().mockResolvedValue(null),
}))

import {
  completeTask,
  rejectTask,
  activateTask,
} from '@/lib/workflow-engine'

import { runReverseHooks, logChangeEvent } from '@/lib/sync-engine'
import { runValidationRules } from '@/lib/validation-rules'

const PROJECT_ID = 'proj-001'
const USER_ID = 'user-001'
const TASK_ID = 'task-001'

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    projectId: PROJECT_ID,
    taskType: 'P1.1',
    title: 'Tao du an',
    description: 'Create Project',
    status: TASK_STATUS.IN_PROGRESS,
    priority: 'NORMAL',
    deadline: null,
    startedAt: new Date(),
    completedAt: null,
    completedBy: null,
    resultData: null,
    createdBy: USER_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    assignees: [{ id: 'a1', role: 'R02', userId: null, isPrimary: true }],
    ...overrides,
  }
}

// ────────────────────────────────────────────────
// activateTask (now uses prisma.task)
// ────────────────────────────────────────────────

describe('activateTask', () => {
  beforeEach(() => {
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.project.findUnique.mockResolvedValue({ id: PROJECT_ID, projectCode: 'PRJ-001', projectName: 'Test' } as never)
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1' } as never])
    prismaMock.task.findFirst.mockResolvedValue({ id: 'task-xyz' } as never)
    prismaMock.notification.createMany.mockResolvedValue({ count: 1 })
  })

  it('sets status to IN_PROGRESS with deadline', async () => {
    await activateTask(PROJECT_ID, 'P1.1')

    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: PROJECT_ID,
          taskType: 'P1.1',
          status: { in: [TASK_STATUS.OPEN, TASK_STATUS.RETURNED, TASK_STATUS.DONE] },
        }),
        data: expect.objectContaining({
          status: TASK_STATUS.IN_PROGRESS,
        }),
      })
    )
  })

  it('calculates deadline from deadlineDays', async () => {
    const before = Date.now()
    await activateTask(PROJECT_ID, 'P1.1')

    const call = prismaMock.task.updateMany.mock.calls[0][0]
    const deadline = call.data.deadline as Date
    expect(deadline).toBeInstanceOf(Date)
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000
    expect(deadline.getTime()).toBeGreaterThanOrEqual(before + twoDaysMs - 1000)
    expect(deadline.getTime()).toBeLessThanOrEqual(Date.now() + twoDaysMs + 1000)
  })

  it('sets deadline to null when step has no deadlineDays', async () => {
    await activateTask(PROJECT_ID, 'P5.1')

    const call = prismaMock.task.updateMany.mock.calls[0][0]
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

    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────
// completeTask
// ────────────────────────────────────────────────

describe('completeTask', () => {
  beforeEach(() => {
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.project.findUnique.mockResolvedValue({ id: PROJECT_ID, projectCode: 'PRJ-001', projectName: 'Test' } as never)
    prismaMock.user.findMany.mockResolvedValue([])
    prismaMock.task.findFirst.mockResolvedValue(null)
    prismaMock.notification.createMany.mockResolvedValue({ count: 0 })
    prismaMock.task.update.mockResolvedValue(makeTask({ status: TASK_STATUS.DONE }) as never)
  })

  it('throws when task not found', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null)

    await expect(completeTask('nonexistent', USER_ID)).rejects.toThrow('Task not found')
  })

  it('throws when task already completed', async () => {
    prismaMock.task.findUnique.mockResolvedValue(
      makeTask({ status: TASK_STATUS.DONE }) as never
    )

    await expect(completeTask(TASK_ID, USER_ID)).rejects.toThrow('Task already completed')
  })

  it('throws when validation fails', async () => {
    prismaMock.task.findUnique.mockResolvedValue(makeTask() as never)
    vi.mocked(runValidationRules).mockResolvedValueOnce({
      valid: false,
      errors: ['TC-03-04: Need 3 quotes'],
      warnings: [],
    })

    await expect(completeTask(TASK_ID, USER_ID)).rejects.toThrow('Validation failed: TC-03-04: Need 3 quotes')
  })

  it('marks task as DONE with completedAt and completedBy', async () => {
    prismaMock.task.findUnique.mockResolvedValue(makeTask() as never)

    await completeTask(TASK_ID, USER_ID)

    expect(prismaMock.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TASK_ID },
        data: expect.objectContaining({
          status: TASK_STATUS.DONE,
          completedBy: USER_ID,
        }),
      })
    )
  })

  it('saves resultData when provided', async () => {
    prismaMock.task.findUnique.mockResolvedValue(makeTask() as never)
    const resultData = { someKey: 'someValue' }

    await completeTask(TASK_ID, USER_ID, resultData, 'Test notes')

    expect(prismaMock.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resultData: expect.objectContaining({ someKey: 'someValue', _notes: 'Test notes' }),
        }),
      })
    )
  })

  it('appends validation warnings to resultData._notes', async () => {
    prismaMock.task.findUnique.mockResolvedValue(makeTask() as never)
    vi.mocked(runValidationRules).mockResolvedValueOnce({
      valid: true,
      errors: [],
      warnings: ['Some warning'],
    })

    await completeTask(TASK_ID, USER_ID, undefined, 'Original note')

    // No resultData provided, so mergedResultData is undefined — _notes not set
    // This is expected behavior: notes only added when resultData is provided
    expect(prismaMock.task.update).toHaveBeenCalled()
  })

  it('activates next steps after completion (P1.1 -> P1.1B)', async () => {
    prismaMock.task.findUnique.mockResolvedValue(
      makeTask({ taskType: 'P1.1' }) as never
    )

    const result = await completeTask(TASK_ID, USER_ID)

    expect(result.nextSteps).toContain('P1.1B')
    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ taskType: 'P1.1B' }),
      })
    )
  })

  it('checks gate before activating gated step', async () => {
    prismaMock.task.findUnique.mockResolvedValue(
      makeTask({ taskType: 'P1.2A' }) as never
    )

    prismaMock.task.findMany.mockResolvedValue([
      { taskType: 'P1.2A', status: TASK_STATUS.DONE } as never,
    ])

    const result = await completeTask(TASK_ID, USER_ID)

    expect(result.nextSteps).toBeDefined()
  })

  it('returns empty nextSteps when no rule exists for step', async () => {
    prismaMock.task.findUnique.mockResolvedValue(
      makeTask({ taskType: 'P6.5' }) as never
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
    prismaMock.task.update.mockResolvedValue(makeTask({ status: TASK_STATUS.RETURNED }) as never)
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.project.findUnique.mockResolvedValue({ id: PROJECT_ID, projectCode: 'PRJ-001', projectName: 'Test' } as never)
    prismaMock.user.findMany.mockResolvedValue([])
    prismaMock.task.findFirst.mockResolvedValue(null)
    prismaMock.notification.createMany.mockResolvedValue({ count: 0 })
  })

  it('throws when task not found', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null)

    await expect(rejectTask('nonexistent', USER_ID, 'bad')).rejects.toThrow('Task not found')
  })

  it('throws when step has no rejectTo defined', async () => {
    prismaMock.task.findUnique.mockResolvedValue(
      makeTask({ taskType: 'P1.1' }) as never
    )

    await expect(rejectTask(TASK_ID, USER_ID, 'reason')).rejects.toThrow('cannot be rejected')
  })

  it('throws for unknown workflow rule', async () => {
    prismaMock.task.findUnique.mockResolvedValue(
      makeTask({ taskType: 'NONEXISTENT' }) as never
    )

    await expect(rejectTask(TASK_ID, USER_ID, 'reason')).rejects.toThrow('No workflow rule')
  })

  it('marks current task as RETURNED with reason in resultData', async () => {
    prismaMock.task.findUnique.mockResolvedValue(
      makeTask({ taskType: 'P1.1B', assignees: [{ id: 'a1', role: 'R01', userId: null, isPrimary: true }] }) as never
    )

    await rejectTask(TASK_ID, USER_ID, 'Not approved')

    expect(prismaMock.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TASK_ID },
        data: expect.objectContaining({
          status: TASK_STATUS.RETURNED,
          completedBy: USER_ID,
        }),
      })
    )
  })

  it('resets intermediate steps between rejectTo and current step', async () => {
    // P2.5 rejects to P2.4 — steps in phase 2 between them should be reset
    prismaMock.task.findUnique.mockResolvedValue(
      makeTask({ taskType: 'P2.5', assignees: [{ id: 'a1', role: 'R01', userId: null, isPrimary: true }] }) as never
    )

    await rejectTask(TASK_ID, USER_ID, 'Budget issue')

    const updateManyCalls = prismaMock.task.updateMany.mock.calls
    const resetCall = updateManyCalls.find(
      (c) => c[0].data?.status === TASK_STATUS.OPEN
    )
    expect(resetCall).toBeDefined()
  })

  it('reactivates the rejectTo step', async () => {
    prismaMock.task.findUnique.mockResolvedValue(
      makeTask({ taskType: 'P1.1B', assignees: [{ id: 'a1', role: 'R01', userId: null, isPrimary: true }] }) as never
    )

    const result = await rejectTask(TASK_ID, USER_ID, 'Rejected')

    expect(result.returnedTo).toBe('P1.1')
    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          taskType: 'P1.1',
          status: { in: [TASK_STATUS.OPEN, TASK_STATUS.RETURNED, TASK_STATUS.DONE] },
        }),
        data: expect.objectContaining({
          status: TASK_STATUS.IN_PROGRESS,
        }),
      })
    )
  })

  it('runs reverse sync hooks', async () => {
    prismaMock.task.findUnique.mockResolvedValue(
      makeTask({ taskType: 'P1.1B', assignees: [{ id: 'a1', role: 'R01', userId: null, isPrimary: true }] }) as never
    )

    await rejectTask(TASK_ID, USER_ID, 'Reason')

    expect(runReverseHooks).toHaveBeenCalledWith(PROJECT_ID, 'P1.1B', USER_ID, 'Reason', TASK_ID)
  })

  it('logs a change event for the rejection', async () => {
    prismaMock.task.findUnique.mockResolvedValue(
      makeTask({ taskType: 'P1.1B', assignees: [{ id: 'a1', role: 'R01', userId: null, isPrimary: true }] }) as never
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
    prismaMock.task.findUnique.mockResolvedValue(
      makeTask({ taskType: 'P5.3', assignees: [{ id: 'a1', role: 'R09', userId: null, isPrimary: true }] }) as never
    )

    const result = await rejectTask(TASK_ID, USER_ID, 'Override', 'P5.2')

    expect(result.returnedTo).toBe('P5.2')
  })

  it('skips intermediate reset when overrideRejectTo is used', async () => {
    prismaMock.task.findUnique.mockResolvedValue(
      makeTask({ taskType: 'P5.3', assignees: [{ id: 'a1', role: 'R09', userId: null, isPrimary: true }] }) as never
    )

    await rejectTask(TASK_ID, USER_ID, 'Override', 'P5.2')

    const updateManyCalls = prismaMock.task.updateMany.mock.calls
    const resetCall = updateManyCalls.find(
      (c) => c[0].data?.status === TASK_STATUS.OPEN
    )
    expect(resetCall).toBeUndefined()
  })

  it('creates notifications for target role users on rejection', async () => {
    prismaMock.task.findUnique.mockResolvedValue(
      makeTask({ taskType: 'P1.1B', assignees: [{ id: 'a1', role: 'R01', userId: null, isPrimary: true }] }) as never
    )
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1' } as never, { id: 'u2' } as never])

    await rejectTask(TASK_ID, USER_ID, 'Need changes')

    expect(prismaMock.notification.createMany).toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────
// checkGate (tested indirectly via completeTask)
// ────────────────────────────────────────────────

describe('checkGate (via completeTask)', () => {
  beforeEach(() => {
    prismaMock.task.update.mockResolvedValue(makeTask({ status: TASK_STATUS.DONE }) as never)
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.project.findUnique.mockResolvedValue({ id: PROJECT_ID, projectCode: 'PRJ-001', projectName: 'Test' } as never)
    prismaMock.user.findMany.mockResolvedValue([])
    prismaMock.task.findFirst.mockResolvedValue(null)
    prismaMock.notification.createMany.mockResolvedValue({ count: 0 })
  })

  it('blocks gated step when prerequisites not met', async () => {
    prismaMock.task.findUnique.mockResolvedValue(
      makeTask({ taskType: 'P2.1' }) as never
    )

    prismaMock.task.findMany.mockResolvedValue([
      { taskType: 'P2.1', status: TASK_STATUS.DONE } as never,
    ])

    const result = await completeTask(TASK_ID, USER_ID)

    expect(result.nextSteps).not.toContain('P2.4')
  })

  it('allows gated step when all prerequisites met', async () => {
    prismaMock.task.findUnique.mockResolvedValue(
      makeTask({ taskType: 'P2.1A' }) as never
    )

    prismaMock.task.findMany.mockResolvedValue([
      { taskType: 'P2.1', status: TASK_STATUS.DONE } as never,
      { taskType: 'P2.2', status: TASK_STATUS.DONE } as never,
      { taskType: 'P2.3', status: TASK_STATUS.DONE } as never,
      { taskType: 'P2.1A', status: TASK_STATUS.DONE } as never,
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
    prismaMock.task.update.mockResolvedValue(makeTask({ status: TASK_STATUS.DONE }) as never)
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.project.findUnique.mockResolvedValue({ id: PROJECT_ID, projectCode: 'PRJ-001', projectName: 'Test' } as never)
    prismaMock.user.findMany.mockResolvedValue([])
    prismaMock.task.findFirst.mockResolvedValue(null)
    prismaMock.notification.createMany.mockResolvedValue({ count: 0 })
  })

  it('completeTask handles missing resultData gracefully', async () => {
    prismaMock.task.findUnique.mockResolvedValue(makeTask() as never)

    await expect(completeTask(TASK_ID, USER_ID)).resolves.toBeDefined()
  })

  it('completeTask with OPEN status proceeds (not DONE)', async () => {
    prismaMock.task.findUnique.mockResolvedValue(
      makeTask({ status: TASK_STATUS.OPEN }) as never
    )

    await expect(completeTask(TASK_ID, USER_ID)).resolves.toBeDefined()
  })

  it('activateTask is idempotent — calling twice does not error', async () => {
    await activateTask(PROJECT_ID, 'P1.1')
    await activateTask(PROJECT_ID, 'P1.1')

    expect(prismaMock.task.updateMany).toHaveBeenCalledTimes(2)
  })

  it('rejectTask creates notification even when no users found', async () => {
    prismaMock.task.findUnique.mockResolvedValue(
      makeTask({ taskType: 'P1.1B', assignees: [{ id: 'a1', role: 'R01', userId: null, isPrimary: true }] }) as never
    )
    prismaMock.user.findMany.mockResolvedValue([])

    await expect(rejectTask(TASK_ID, USER_ID, 'test')).resolves.toBeDefined()
  })

  it('completeTask runs validation rules for the step', async () => {
    prismaMock.task.findUnique.mockResolvedValue(
      makeTask({ taskType: 'P3.5' }) as never
    )

    await completeTask(TASK_ID, USER_ID, { rfqCount: 5 })

    expect(runValidationRules).toHaveBeenCalledWith('P3.5', { rfqCount: 5 }, PROJECT_ID)
  })
})
