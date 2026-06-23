import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db')

const { mockSendGroupMessage } = vi.hoisted(() => ({
  mockSendGroupMessage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/telegram', () => ({
  sendGroupMessage: mockSendGroupMessage,
  escapeHtml: (s: string) => s,
  formatDeadline: (d: Date) => d.toISOString().slice(0, 10),
}))

import { prismaMock } from '@/lib/__mocks__/db'
import { runDailyDigest } from '@/lib/cron-jobs'

describe('runDailyDigest — execReviewedAt filter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.user.findMany.mockResolvedValue([])
  })

  it('excludes task with execReviewedAt < 7 days from exec list', async () => {
    const now = new Date('2026-06-23T10:00:00+07:00')
    vi.spyOn(Date, 'now').mockReturnValue(now.getTime())

    const recentReview = new Date('2026-06-20T10:00:00+07:00').toISOString()
    prismaMock.task.findMany.mockResolvedValue([
      {
        id: 't1', title: 'Việc đã bàn', status: 'IN_PROGRESS',
        deadline: new Date('2026-06-01'), blocked: true, escalated: false,
        resultData: { briefing: { execReviewedAt: recentReview } },
        project: { id: 'p1', projectCode: 'P001', projectName: 'Test' },
        assignees: [{ userId: null, role: 'R02' }],
      },
    ] as any)

    const result = await runDailyDigest()
    expect(result.exec).toBe(0)

    vi.spyOn(Date, 'now').mockRestore()
  })

  it('includes task with execReviewedAt > 7 days ago in exec list', async () => {
    const now = new Date('2026-06-23T10:00:00+07:00')
    vi.spyOn(Date, 'now').mockReturnValue(now.getTime())

    const oldReview = new Date('2026-06-10T10:00:00+07:00').toISOString()
    prismaMock.task.findMany.mockResolvedValue([
      {
        id: 't2', title: 'Việc cũ', status: 'IN_PROGRESS',
        deadline: new Date('2026-06-01'), blocked: true, escalated: false,
        resultData: { briefing: { execReviewedAt: oldReview } },
        project: { id: 'p1', projectCode: 'P001', projectName: 'Test' },
        assignees: [{ userId: null, role: 'R02' }],
      },
    ] as any)

    const result = await runDailyDigest()
    expect(result.exec).toBe(1)

    vi.spyOn(Date, 'now').mockRestore()
  })

  it('includes task with no execReviewedAt in exec list', async () => {
    const now = new Date('2026-06-23T10:00:00+07:00')
    vi.spyOn(Date, 'now').mockReturnValue(now.getTime())

    prismaMock.task.findMany.mockResolvedValue([
      {
        id: 't3', title: 'Việc chưa bàn', status: 'IN_PROGRESS',
        deadline: new Date('2026-06-01'), blocked: true, escalated: false,
        resultData: {},
        project: { id: 'p1', projectCode: 'P001', projectName: 'Test' },
        assignees: [{ userId: null, role: 'R02' }],
      },
    ] as any)

    const result = await runDailyDigest()
    expect(result.exec).toBe(1)

    vi.spyOn(Date, 'now').mockRestore()
  })
})
