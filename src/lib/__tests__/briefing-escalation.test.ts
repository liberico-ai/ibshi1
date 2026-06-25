import { describe, it, expect } from 'vitest'

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    status: 'IN_PROGRESS',
    escalated: false,
    blocked: false,
    isOverdue: false,
    daysOverdue: 0,
    discussedAt: '',
    discussNote: '',
    decision: '',
    notes: '',
    proposal: '',
    escalateType: '',
    escalateQuestion: '',
    ...overrides,
  }
}

function needsExecDecision(t: ReturnType<typeof makeTask>, weekAgoMs = 7 * 86400000) {
  const now = Date.now()
  const execReviewedAt = (t as Record<string, unknown>).execReviewedAt
    ? new Date((t as Record<string, unknown>).execReviewedAt as string)
    : null
  const reviewedRecently = !!(execReviewedAt && (now - execReviewedAt.getTime()) < weekAgoMs)
  return t.status !== 'DONE' && t.status !== 'CANCELLED' && t.escalated === true && !reviewedRecently
}

function hasOutcome(t: ReturnType<typeof makeTask>) {
  return !!(t.decision || t.discussNote || t.notes)
}

describe('needsExecDecision — only when escalated', () => {
  it('returns true when escalated is true', () => {
    expect(needsExecDecision(makeTask({ escalated: true }))).toBe(true)
  })

  it('returns false when escalated is false', () => {
    expect(needsExecDecision(makeTask({ escalated: false }))).toBe(false)
  })

  it('returns false even when blocked (not escalated)', () => {
    expect(needsExecDecision(makeTask({ blocked: true, escalated: false }))).toBe(false)
  })

  it('returns false even when overdue >= 14d (not escalated)', () => {
    expect(needsExecDecision(makeTask({ isOverdue: true, daysOverdue: 20, escalated: false }))).toBe(false)
  })

  it('returns false for DONE tasks even if escalated', () => {
    expect(needsExecDecision(makeTask({ escalated: true, status: 'DONE' }))).toBe(false)
  })

  it('returns false when recently reviewed', () => {
    const recentDate = new Date(Date.now() - 2 * 86400000).toISOString()
    expect(needsExecDecision(makeTask({ escalated: true, execReviewedAt: recentDate }))).toBe(false)
  })
})

describe('escalation validation — type and question required', () => {
  it('escalation must have type', () => {
    const body = { taskId: 't1', escalated: true, escalateType: '', escalateQuestion: 'what?' }
    const valid = !!(body.escalateType?.trim())
    expect(valid).toBe(false)
  })

  it('escalation must have question', () => {
    const body = { taskId: 't1', escalated: true, escalateType: 'Rủi ro/tranh chấp', escalateQuestion: '' }
    const valid = !!(body.escalateQuestion?.trim())
    expect(valid).toBe(false)
  })

  it('valid escalation has both', () => {
    const body = { taskId: 't1', escalated: true, escalateType: 'Vượt thẩm quyền/ngân sách', escalateQuestion: 'Phê duyệt chi phí phát sinh' }
    const valid = !!(body.escalateType?.trim()) && !!(body.escalateQuestion?.trim())
    expect(valid).toBe(true)
  })

  it('de-escalation does not require type/question', () => {
    const body = { taskId: 't1', escalated: false }
    const needsValidation = body.escalated === true
    expect(needsValidation).toBe(false)
  })
})

describe('discussed with note (discussNote)', () => {
  it('discussed saves discussNote', () => {
    const patch: Record<string, unknown> = { discussedAt: new Date().toISOString() }
    const note = 'Cần bổ sung hồ sơ phần móng'
    if (note) patch.discussNote = note
    expect(patch.discussNote).toBe('Cần bổ sung hồ sơ phần móng')
    expect(patch.discussedAt).toBeTruthy()
  })

  it('discussed without note still sets discussedAt', () => {
    const patch: Record<string, unknown> = { discussedAt: new Date().toISOString() }
    expect(patch.discussNote).toBeUndefined()
    expect(patch.discussedAt).toBeTruthy()
  })
})

describe('hasOutcome — task with result counts as "có kết quả"', () => {
  it('task with decision has outcome', () => {
    expect(hasOutcome(makeTask({ decision: 'Duyệt' }))).toBe(true)
  })

  it('task with discussNote has outcome', () => {
    expect(hasOutcome(makeTask({ discussNote: 'Ghi chú bàn' }))).toBe(true)
  })

  it('task with notes has outcome', () => {
    expect(hasOutcome(makeTask({ notes: 'Ghi chú chung' }))).toBe(true)
  })

  it('task with nothing has no outcome', () => {
    expect(hasOutcome(makeTask())).toBe(false)
  })

  it('proposal alone does NOT count as outcome', () => {
    expect(hasOutcome(makeTask({ proposal: 'Đề xuất tăng NCC' }))).toBe(false)
  })
})
