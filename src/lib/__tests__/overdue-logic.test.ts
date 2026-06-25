import { describe, it, expect } from 'vitest'
import {
  isOverdueForDoer, isLateForReview, isTaskOverdue,
  taskDaysOverdue, isCompletedLate, overdueForUser, reviewDueDate,
} from '@/lib/utils'

function day(offset: number): Date {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d
}

describe('isOverdueForDoer', () => {
  it('returns true when OPEN task is past deadline', () => {
    expect(isOverdueForDoer({ status: 'OPEN', deadline: day(-3) })).toBe(true)
  })

  it('returns true for IN_PROGRESS past deadline', () => {
    expect(isOverdueForDoer({ status: 'IN_PROGRESS', deadline: day(-1) })).toBe(true)
  })

  it('returns true for RETURNED past deadline', () => {
    expect(isOverdueForDoer({ status: 'RETURNED', deadline: day(-2) })).toBe(true)
  })

  it('returns false for AWAITING_REVIEW even if past deadline', () => {
    expect(isOverdueForDoer({ status: 'AWAITING_REVIEW', deadline: day(-5) })).toBe(false)
  })

  it('returns false for DONE', () => {
    expect(isOverdueForDoer({ status: 'DONE', deadline: day(-5) })).toBe(false)
  })

  it('returns false when deadline is in the future', () => {
    expect(isOverdueForDoer({ status: 'OPEN', deadline: day(3) })).toBe(false)
  })

  it('returns false when no deadline', () => {
    expect(isOverdueForDoer({ status: 'OPEN', deadline: null })).toBe(false)
  })
})

describe('reviewDueDate', () => {
  it('returns max(deadline, submittedAt+2) when both exist', () => {
    const dl = day(-1)
    const submitted = day(-5)
    const result = reviewDueDate({ status: 'AWAITING_REVIEW', deadline: dl, submittedAt: submitted })
    expect(result).not.toBeNull()
    const submittedPlus2 = day(-3).getTime()
    expect(result!.getTime()).toBe(Math.max(dl.getTime(), submittedPlus2))
  })

  it('uses deadline when submittedAt is null', () => {
    const dl = day(-3)
    const result = reviewDueDate({ status: 'AWAITING_REVIEW', deadline: dl, submittedAt: null })
    expect(result!.getTime()).toBe(dl.getTime())
  })

  it('returns null for non-AWAITING_REVIEW status', () => {
    expect(reviewDueDate({ status: 'OPEN', deadline: day(-3) })).toBeNull()
  })

  it('returns null when no deadline', () => {
    expect(reviewDueDate({ status: 'AWAITING_REVIEW', deadline: null })).toBeNull()
  })
})

describe('isLateForReview', () => {
  it('returns true when AWAITING_REVIEW and past review due date', () => {
    expect(isLateForReview({
      status: 'AWAITING_REVIEW', deadline: day(-10), submittedAt: day(-5),
    })).toBe(true)
  })

  it('returns false when submitted recently (within grace period)', () => {
    expect(isLateForReview({
      status: 'AWAITING_REVIEW', deadline: day(-1), submittedAt: day(0),
    })).toBe(false)
  })

  it('returns false for non-AWAITING_REVIEW', () => {
    expect(isLateForReview({ status: 'IN_PROGRESS', deadline: day(-10) })).toBe(false)
  })

  it('submitted late → reviewDue = submitted+2, not oan deadline ngay', () => {
    const submitted = day(-1)
    const result = isLateForReview({
      status: 'AWAITING_REVIEW', deadline: day(-5), submittedAt: submitted,
    })
    expect(result).toBe(false)
  })
})

describe('isTaskOverdue (unified)', () => {
  it('doer overdue counts as overdue', () => {
    expect(isTaskOverdue({ status: 'OPEN', deadline: day(-2) })).toBe(true)
  })

  it('review late counts as overdue', () => {
    expect(isTaskOverdue({
      status: 'AWAITING_REVIEW', deadline: day(-10), submittedAt: day(-5),
    })).toBe(true)
  })

  it('AWAITING_REVIEW within grace is NOT overdue', () => {
    expect(isTaskOverdue({
      status: 'AWAITING_REVIEW', deadline: day(-1), submittedAt: day(0),
    })).toBe(false)
  })

  it('DONE is not overdue (even if past deadline)', () => {
    expect(isTaskOverdue({ status: 'DONE', deadline: day(-5) })).toBe(false)
  })

  it('CANCELLED is not overdue', () => {
    expect(isTaskOverdue({ status: 'CANCELLED', deadline: day(-5) })).toBe(false)
  })
})

describe('taskDaysOverdue', () => {
  it('counts doer days past deadline', () => {
    const days = taskDaysOverdue({ status: 'IN_PROGRESS', deadline: day(-3) })
    expect(days).toBe(3)
  })

  it('counts review days past review due date', () => {
    const days = taskDaysOverdue({
      status: 'AWAITING_REVIEW', deadline: day(-10), submittedAt: day(-5),
    })
    expect(days).toBeGreaterThanOrEqual(2)
  })

  it('returns 0 for tasks not overdue', () => {
    expect(taskDaysOverdue({ status: 'OPEN', deadline: day(5) })).toBe(0)
  })

  it('DONE completed late → returns days late', () => {
    const days = taskDaysOverdue({
      status: 'DONE', deadline: day(-10), completedAt: day(-7),
    })
    expect(days).toBe(3)
  })

  it('DONE completed on time → 0', () => {
    expect(taskDaysOverdue({
      status: 'DONE', deadline: day(-5), completedAt: day(-6),
    })).toBe(0)
  })
})

describe('isCompletedLate', () => {
  it('true when DONE and completedAt > deadline', () => {
    expect(isCompletedLate({
      status: 'DONE', deadline: day(-10), completedAt: day(-7),
    })).toBe(true)
  })

  it('false when completed on time', () => {
    expect(isCompletedLate({
      status: 'DONE', deadline: day(-5), completedAt: day(-6),
    })).toBe(false)
  })

  it('false for non-DONE status', () => {
    expect(isCompletedLate({
      status: 'IN_PROGRESS', deadline: day(-5), completedAt: day(-3),
    })).toBe(false)
  })
})

describe('overdueForUser', () => {
  const base = { deadline: day(-5) }

  it('returns doer for assignee of overdue active task', () => {
    expect(overdueForUser(
      { ...base, status: 'IN_PROGRESS', createdBy: 'u2', assignees: [{ userId: 'u1', role: 'R04' }] },
      'u1', 'R04',
    )).toBe('doer')
  })

  it('returns review for creator of late AWAITING_REVIEW', () => {
    expect(overdueForUser(
      { ...base, status: 'AWAITING_REVIEW', deadline: day(-10), submittedAt: day(-5), createdBy: 'u1', assignees: [{ userId: 'u2' }] },
      'u1',
    )).toBe('review')
  })

  it('returns null for non-overdue task', () => {
    expect(overdueForUser(
      { status: 'OPEN', deadline: day(5), createdBy: 'u1', assignees: [{ userId: 'u1' }] },
      'u1',
    )).toBeNull()
  })

  it('returns null for assignee of AWAITING_REVIEW (not their overdue)', () => {
    expect(overdueForUser(
      { status: 'AWAITING_REVIEW', deadline: day(-10), submittedAt: day(-5), createdBy: 'u2', assignees: [{ userId: 'u1' }] },
      'u1',
    )).toBeNull()
  })
})
