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

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1', title: 'Việc mẫu', status: 'IN_PROGRESS',
    deadline: new Date('2026-06-01'), blocked: false, escalated: false,
    resultData: {},
    project: { id: 'p1', projectCode: 'DA-100', projectName: 'Dự án A' },
    assignees: [{ userId: null, role: 'R02' }],
    ...overrides,
  }
}

describe('runDailyDigest — needsExec = escalated only', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.user.findMany.mockResolvedValue([])
  })

  it('escalated=true with recent execReviewedAt → excluded from exec', async () => {
    const now = new Date('2026-06-23T10:00:00+07:00')
    vi.spyOn(Date, 'now').mockReturnValue(now.getTime())

    prismaMock.task.findMany.mockResolvedValue([
      makeTask({
        escalated: true,
        resultData: { briefing: { execReviewedAt: new Date('2026-06-20T10:00:00+07:00').toISOString() } },
      }),
    ] as never)

    const result = await runDailyDigest()
    expect(result.exec).toBe(0)
    vi.spyOn(Date, 'now').mockRestore()
  })

  it('escalated=true with old execReviewedAt → included in exec', async () => {
    const now = new Date('2026-06-23T10:00:00+07:00')
    vi.spyOn(Date, 'now').mockReturnValue(now.getTime())

    prismaMock.task.findMany.mockResolvedValue([
      makeTask({
        escalated: true,
        resultData: { briefing: { execReviewedAt: new Date('2026-06-10T10:00:00+07:00').toISOString() } },
      }),
    ] as never)

    const result = await runDailyDigest()
    expect(result.exec).toBe(1)
    vi.spyOn(Date, 'now').mockRestore()
  })

  it('escalated=true with no execReviewedAt → included in exec', async () => {
    const now = new Date('2026-06-23T10:00:00+07:00')
    vi.spyOn(Date, 'now').mockReturnValue(now.getTime())

    prismaMock.task.findMany.mockResolvedValue([
      makeTask({ escalated: true }),
    ] as never)

    const result = await runDailyDigest()
    expect(result.exec).toBe(1)
    vi.spyOn(Date, 'now').mockRestore()
  })

  it('blocked=true but NOT escalated → exec=0, blocked=1', async () => {
    const now = new Date('2026-06-23T10:00:00+07:00')
    vi.spyOn(Date, 'now').mockReturnValue(now.getTime())

    prismaMock.task.findMany.mockResolvedValue([
      makeTask({
        blocked: true,
        resultData: { briefing: { blockResolver: { name: 'Nguyễn A' }, blockedAt: '2026-06-20T00:00:00Z' } },
      }),
    ] as never)

    const result = await runDailyDigest()
    expect(result.exec).toBe(0)
    expect(result.blocked).toBe(1)
    vi.spyOn(Date, 'now').mockRestore()
  })

  it('overdue>=14d but NOT escalated → exec=0, overdue=1', async () => {
    const now = new Date('2026-06-23T10:00:00+07:00')
    vi.spyOn(Date, 'now').mockReturnValue(now.getTime())

    prismaMock.task.findMany.mockResolvedValue([
      makeTask({ deadline: new Date('2026-06-01') }),
    ] as never)

    const result = await runDailyDigest()
    expect(result.exec).toBe(0)
    expect(result.overdue).toBe(1)
    vi.spyOn(Date, 'now').mockRestore()
  })
})

describe('runDailyDigest — filters test projects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.user.findMany.mockResolvedValue([])
  })

  it('skips project with name containing "Test"', async () => {
    const now = new Date('2026-06-23T10:00:00+07:00')
    vi.spyOn(Date, 'now').mockReturnValue(now.getTime())

    prismaMock.task.findMany.mockResolvedValue([
      makeTask({
        project: { id: 'p1', projectCode: 'DA-001', projectName: 'Toàn Test' },
        deadline: new Date('2026-06-01'),
      }),
    ] as never)

    const result = await runDailyDigest()
    expect(result.overdue).toBe(0)
    expect(result.projects).toBe(0)
    vi.spyOn(Date, 'now').mockRestore()
  })

  it('keeps project with normal name', async () => {
    const now = new Date('2026-06-23T10:00:00+07:00')
    vi.spyOn(Date, 'now').mockReturnValue(now.getTime())

    prismaMock.task.findMany.mockResolvedValue([
      makeTask({ deadline: new Date('2026-06-01') }),
    ] as never)

    const result = await runDailyDigest()
    expect(result.overdue).toBe(1)
    expect(result.projects).toBe(1)
    vi.spyOn(Date, 'now').mockRestore()
  })
})

describe('runDailyDigest — escalate type/question in message', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.user.findMany.mockResolvedValue([])
  })

  it('includes escalateType and escalateQuestion in output', async () => {
    const now = new Date('2026-06-23T10:00:00+07:00')
    vi.spyOn(Date, 'now').mockReturnValue(now.getTime())

    prismaMock.task.findMany.mockResolvedValue([
      makeTask({
        escalated: true,
        resultData: { briefing: { escalate: { type: 'Thiếu ngân sách', question: 'Phê duyệt thêm 50tr?' } } },
      }),
    ] as never)

    await runDailyDigest()
    const msg = mockSendGroupMessage.mock.calls[0][0] as string
    expect(msg).toContain('Thiếu ngân sách')
    expect(msg).toContain('Phê duyệt thêm 50tr?')
    vi.spyOn(Date, 'now').mockRestore()
  })
})
