import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'

const { mockAuthUser } = vi.hoisted(() => ({
  mockAuthUser: {
    userId: 'user-1',
    roleCode: 'R06',
    username: 'worker',
    userLevel: 2,
    fullName: 'Worker User',
  },
}))

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return {
    ...actual,
    authenticateRequest: vi.fn().mockResolvedValue(mockAuthUser),
    logAudit: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('@/lib/task-engine', () => ({
  getTaskInbox: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/cache', () => ({
  withCache: vi.fn((_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()),
  cacheInvalidate: vi.fn().mockResolvedValue(undefined),
  CACHE_KEYS: { projects: 'projects:*', dashboard: 'dashboard:*', tasks: 'tasks:*', warehouse: 'warehouse:*', admin: 'admin:*' },
}))

import { GET } from '@/app/api/tasks/route'
import { authenticateRequest } from '@/lib/auth'
import { getTaskInbox } from '@/lib/task-engine'

const SAMPLE_TASK = {
  id: 'task-1',
  stepCode: 'P3.1',
  stepName: 'Sản xuất',
  status: 'IN_PROGRESS',
  priority: 1,
  deadline: null,
  assignedTo: 'user-1',
  assignedRole: 'R06',
  projectId: 'proj-1',
  project: { projectCode: 'P-001', projectName: 'Test Project', clientName: 'Client' },
  assignee: { fullName: 'Worker User', username: 'worker' },
}

describe('GET /api/tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(mockAuthUser)
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue(null)

    const req = new Request('http://localhost/api/tasks')
    const res = await GET(req as any)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  it('returns empty task list when no tasks', async () => {
    vi.mocked(getTaskInbox).mockResolvedValue([])

    const req = new Request('http://localhost/api/tasks')
    const res = await GET(req as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.tasks).toEqual([])
  })

  it('returns tasks with urgency=normal for tasks without deadline', async () => {
    vi.mocked(getTaskInbox).mockResolvedValue([SAMPLE_TASK] as any)

    const req = new Request('http://localhost/api/tasks')
    const res = await GET(req as any)
    const json = await res.json()
    expect(json.tasks).toHaveLength(1)
    expect(json.tasks[0].urgency).toBe('normal')
  })

  it('returns tasks with urgency=overdue for past deadlines', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    vi.mocked(getTaskInbox).mockResolvedValue([{ ...SAMPLE_TASK, deadline: yesterday }] as any)

    const req = new Request('http://localhost/api/tasks')
    const res = await GET(req as any)
    const json = await res.json()
    expect(json.tasks[0].urgency).toBe('overdue')
  })

  it('returns tasks with urgency=today for tasks due within 24h', async () => {
    const inTwelveHours = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
    vi.mocked(getTaskInbox).mockResolvedValue([{ ...SAMPLE_TASK, deadline: inTwelveHours }] as any)

    const req = new Request('http://localhost/api/tasks')
    const res = await GET(req as any)
    const json = await res.json()
    expect(json.tasks[0].urgency).toBe('today')
  })

  it('sorts tasks with overdue first', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const inTwelveHours = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
    vi.mocked(getTaskInbox).mockResolvedValue([
      { ...SAMPLE_TASK, id: 'task-today', deadline: inTwelveHours },
      { ...SAMPLE_TASK, id: 'task-overdue', deadline: yesterday },
    ] as any)

    const req = new Request('http://localhost/api/tasks')
    const res = await GET(req as any)
    const json = await res.json()
    expect(json.tasks[0].urgency).toBe('overdue')
    expect(json.tasks[1].urgency).toBe('today')
  })

  it('calls getTaskInbox with the authenticated user id and role', async () => {
    vi.mocked(getTaskInbox).mockResolvedValue([])

    const req = new Request('http://localhost/api/tasks')
    await GET(req as any)
    expect(getTaskInbox).toHaveBeenCalledWith('user-1', 'R06')
  })
})
