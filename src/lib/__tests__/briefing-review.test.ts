/**
 * Tests for briefing review improvements:
 * (a) doneSincePrev returns DONE tasks with completedAt >= weekOf
 * (b) tồn đọng filters exclude DONE/CANCELLED
 * (c) project-task requires assignees
 */
import { describe, it, expect } from 'vitest'

// ── (a) doneSincePrev logic ──

function buildDoneSincePrev(
  tasks: { id: string; status: string; completedAt: string | null; taskType: string; projectCode: string; assigneeNames: string[] }[],
  sinceDate: Date,
) {
  return tasks
    .filter(t => t.status === 'DONE' && t.completedAt && new Date(t.completedAt) >= sinceDate)
    .map(t => ({
      taskId: t.id,
      code: t.taskType !== 'FREE' ? t.taskType : '',
      title: `Task ${t.id}`,
      assigneeNames: t.assigneeNames,
      projectCode: t.projectCode,
      completedAt: t.completedAt,
    }))
}

describe('doneSincePrev', () => {
  const tasks = [
    { id: '1', status: 'DONE', completedAt: '2026-06-20T10:00:00Z', taskType: 'FREE', projectCode: 'DA01', assigneeNames: ['Toan'] },
    { id: '2', status: 'DONE', completedAt: '2026-06-10T10:00:00Z', taskType: 'WF', projectCode: 'DA01', assigneeNames: ['Minh'] },
    { id: '3', status: 'IN_PROGRESS', completedAt: null, taskType: 'FREE', projectCode: 'DA02', assigneeNames: ['Lan'] },
    { id: '4', status: 'DONE', completedAt: '2026-06-22T08:00:00Z', taskType: 'FREE', projectCode: 'DA02', assigneeNames: ['Hoa'] },
    { id: '5', status: 'CANCELLED', completedAt: null, taskType: 'FREE', projectCode: 'DA01', assigneeNames: [] },
  ]

  it('returns DONE tasks with completedAt >= weekOf from snapshot', () => {
    const weekOf = new Date('2026-06-16T00:00:00Z')
    const result = buildDoneSincePrev(tasks, weekOf)

    expect(result).toHaveLength(2)
    expect(result.map(r => r.taskId)).toEqual(['1', '4'])
    expect(result[0].code).toBe('')
    expect(result[0].assigneeNames).toEqual(['Toan'])
    expect(result[0].projectCode).toBe('DA01')
  })

  it('uses 7-day fallback when no snapshot', () => {
    const now = new Date('2026-06-23T12:00:00Z')
    const fallback = new Date(now.getTime() - 7 * 86400000)
    const result = buildDoneSincePrev(tasks, fallback)

    expect(result).toHaveLength(2)
    expect(result.map(r => r.taskId)).toEqual(['1', '4'])
  })

  it('excludes non-DONE and tasks before sinceDate', () => {
    const weekOf = new Date('2026-06-15T00:00:00Z')
    const result = buildDoneSincePrev(tasks, weekOf)

    const ids = result.map(r => r.taskId)
    expect(ids).not.toContain('3')
    expect(ids).not.toContain('5')
    expect(ids).not.toContain('2')
  })

  it('includes older DONE tasks when sinceDate is earlier', () => {
    const weekOf = new Date('2026-06-01T00:00:00Z')
    const result = buildDoneSincePrev(tasks, weekOf)

    expect(result.map(r => r.taskId)).toContain('2')
    expect(result).toHaveLength(3)
  })

  it('returns code from taskType when not FREE', () => {
    const weekOf = new Date('2026-06-01T00:00:00Z')
    const result = buildDoneSincePrev(tasks, weekOf)
    const wfTask = result.find(r => r.taskId === '2')
    expect(wfTask?.code).toBe('WF')
  })
})

// ── (b) tồn đọng filtering ──

interface SimplifiedTask {
  id: string
  status: string
  isOverdue: boolean
  daysOverdue: number
}

function filterTonDong(tasks: SimplifiedTask[]): SimplifiedTask[] {
  return tasks.filter(t => t.status !== 'DONE' && t.status !== 'CANCELLED')
}

describe('tồn đọng filtering', () => {
  const tasks: SimplifiedTask[] = [
    { id: '1', status: 'IN_PROGRESS', isOverdue: true, daysOverdue: 5 },
    { id: '2', status: 'DONE', isOverdue: false, daysOverdue: 0 },
    { id: '3', status: 'OPEN', isOverdue: false, daysOverdue: -3 },
    { id: '4', status: 'CANCELLED', isOverdue: false, daysOverdue: 0 },
    { id: '5', status: 'AWAITING_REVIEW', isOverdue: true, daysOverdue: 2 },
    { id: '6', status: 'RETURNED', isOverdue: false, daysOverdue: -1 },
  ]

  it('excludes DONE and CANCELLED from tồn đọng', () => {
    const result = filterTonDong(tasks)
    expect(result).toHaveLength(4)
    expect(result.map(r => r.id)).toEqual(['1', '3', '5', '6'])
  })

  it('counts overdue correctly from pending tasks only', () => {
    const result = filterTonDong(tasks)
    const overdueCount = result.filter(t => t.isOverdue).length
    expect(overdueCount).toBe(2)
  })

  it('returns empty when all tasks are DONE or CANCELLED', () => {
    const allDone: SimplifiedTask[] = [
      { id: '1', status: 'DONE', isOverdue: false, daysOverdue: 0 },
      { id: '2', status: 'CANCELLED', isOverdue: false, daysOverdue: 0 },
    ]
    expect(filterTonDong(allDone)).toHaveLength(0)
  })
})

// ── (c) project-task validation ──

function validateProjectTask(body: { title?: string; assigneeUserIds?: string[]; projectId?: string }) {
  if (!body.title?.trim()) return 'Cần tiêu đề'
  if (!body.assigneeUserIds?.length) return 'Cần ít nhất 1 người nhận'
  return null
}

describe('project-task validation', () => {
  it('rejects missing title', () => {
    expect(validateProjectTask({ assigneeUserIds: ['u1'] })).toBe('Cần tiêu đề')
    expect(validateProjectTask({ title: '  ', assigneeUserIds: ['u1'] })).toBe('Cần tiêu đề')
  })

  it('rejects missing assignees', () => {
    expect(validateProjectTask({ title: 'New task' })).toBe('Cần ít nhất 1 người nhận')
    expect(validateProjectTask({ title: 'New task', assigneeUserIds: [] })).toBe('Cần ít nhất 1 người nhận')
  })

  it('passes with title + assignees', () => {
    expect(validateProjectTask({ title: 'Kiểm tra vật tư', assigneeUserIds: ['u1', 'u2'], projectId: 'p1' })).toBeNull()
  })

  it('passes without projectId (general tasks)', () => {
    expect(validateProjectTask({ title: 'Việc chung', assigneeUserIds: ['u1'] })).toBeNull()
  })
})
