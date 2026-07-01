import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prismaMock } from '@/lib/__mocks__/db'

const { mockAuthUser } = vi.hoisted(() => ({
  mockAuthUser: {
    userId: 'user-1',
    roleCode: 'R01',
    username: 'admin',
    userLevel: 1,
    fullName: 'Admin User',
  },
}))

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return {
    ...actual,
    authenticateRequest: vi.fn().mockResolvedValue(mockAuthUser),
    logAudit: vi.fn().mockResolvedValue(undefined),
    getClientIP: vi.fn().mockReturnValue('127.0.0.1'),
    getUserProjectIds: vi.fn().mockResolvedValue(null),
  }
})

vi.mock('@/lib/workflow-engine', () => ({
  WORKFLOW_RULES: {},
  PHASE_LABELS: {},
  getWorkflowProgress: vi.fn(),
}))

vi.mock('@/lib/cache', () => ({
  withCache: vi.fn((_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()),
  cacheInvalidate: vi.fn().mockResolvedValue(undefined),
  CACHE_KEYS: { projects: 'projects:*', dashboard: 'dashboard:*', tasks: 'tasks:*', warehouse: 'warehouse:*', admin: 'admin:*' },
}))

vi.mock('@/lib/webhook', () => ({
  emitContractUpdated: vi.fn().mockResolvedValue(undefined),
}))

import { PATCH } from '@/app/api/projects/[id]/route'

const PROJECT_ID = 'proj-close-1'

function makeReq(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const routeCtx = { params: Promise.resolve({ id: PROJECT_ID }) }

const GATE_TASKS = [
  { id: 't1', taskType: 'P6.1', status: 'DONE' },
  { id: 't2', taskType: 'P6.2', status: 'DONE' },
  { id: 't3', taskType: 'P6.3', status: 'DONE' },
]

const SAMPLE_PROJECT = {
  id: PROJECT_ID,
  projectCode: 'P-CLOSE',
  projectName: 'Close Test',
  clientName: 'Client',
  productType: 'Steel',
  status: 'CLOSED',
  contractValue: null,
  currency: 'VND',
  startDate: null,
  endDate: null,
  createdAt: new Date(),
}

describe('PATCH /api/projects/[id] action=CLOSE — NCR/ECO gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('blocks close when NCR is still open', async () => {
    prismaMock.task.findMany.mockResolvedValue(GATE_TASKS as never)
    prismaMock.nonConformanceReport.count.mockResolvedValue(2)
    prismaMock.engineeringChangeOrder.count.mockResolvedValue(0)

    const res = await PATCH(makeReq({ action: 'CLOSE' }), routeCtx)
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.error).toContain('2 NCR')
  })

  it('blocks close when ECO is still open (DRAFT/SUBMITTED/APPROVED)', async () => {
    prismaMock.task.findMany.mockResolvedValue(GATE_TASKS as never)
    prismaMock.nonConformanceReport.count.mockResolvedValue(0)
    prismaMock.engineeringChangeOrder.count.mockResolvedValue(3)

    const res = await PATCH(makeReq({ action: 'CLOSE' }), routeCtx)
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.error).toContain('3 ECO')
  })

  it('blocks close when both NCR and ECO are open', async () => {
    prismaMock.task.findMany.mockResolvedValue(GATE_TASKS as never)
    prismaMock.nonConformanceReport.count.mockResolvedValue(1)
    prismaMock.engineeringChangeOrder.count.mockResolvedValue(2)

    const res = await PATCH(makeReq({ action: 'CLOSE' }), routeCtx)
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toContain('1 NCR')
    expect(json.error).toContain('2 ECO')
  })

  it('allows close when all NCR closed and ECO implemented/rejected', async () => {
    prismaMock.task.findMany.mockResolvedValue(GATE_TASKS as never)
    prismaMock.nonConformanceReport.count.mockResolvedValue(0)
    prismaMock.engineeringChangeOrder.count.mockResolvedValue(0)
    prismaMock.$transaction.mockImplementation((fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock))
    prismaMock.project.update.mockResolvedValue(SAMPLE_PROJECT as never)
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 } as never)
    prismaMock.auditLog.create.mockResolvedValue({} as never)

    const res = await PATCH(makeReq({ action: 'CLOSE' }), routeCtx)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.project.projectCode).toBe('P-CLOSE')
  })
})
