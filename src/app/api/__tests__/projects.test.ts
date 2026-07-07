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
  initializeProjectWorkflow: vi.fn().mockResolvedValue(undefined),
  completeTask: vi.fn().mockResolvedValue(undefined),
  WORKFLOW_RULES: {},
  PHASE_LABELS: {},
  getWorkflowProgress: vi.fn(),
}))

// Cache is a no-op when Redis is not configured
vi.mock('@/lib/cache', () => ({
  withCache: vi.fn((_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()),
  cacheInvalidate: vi.fn().mockResolvedValue(undefined),
  CACHE_KEYS: { projects: 'projects:*', dashboard: 'dashboard:*', tasks: 'tasks:*', warehouse: 'warehouse:*', admin: 'admin:*' },
}))

import { GET, POST } from '@/app/api/projects/route'
import { GET as optionsGET } from '@/app/api/projects/options/route'
import { authenticateRequest } from '@/lib/auth'

const SAMPLE_PROJECT = {
  id: 'proj-1',
  projectCode: 'P-001',
  projectName: 'Test Project',
  clientName: 'Test Client',
  productType: 'Steel',
  status: 'ACTIVE',
  contractValue: null,
  currency: 'VND',
  startDate: null,
  endDate: null,
  createdAt: new Date(),
  dynamicTasks: [],
}

describe('GET /api/projects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(mockAuthUser)
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/projects')
    const res = await GET(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  it('returns paginated project list', async () => {
    prismaMock.project.count.mockResolvedValue(1)
    prismaMock.project.findMany.mockResolvedValue([SAMPLE_PROJECT] as any)

    const req = new NextRequest('http://localhost/api/projects?page=1&limit=20')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.projects).toHaveLength(1)
    expect(json.projects[0]).toMatchObject({
      id: 'proj-1',
      projectCode: 'P-001',
      projectName: 'Test Project',
    })
    expect(json.pagination).toMatchObject({ page: 1, limit: 20, total: 1 })
  })

  it('returns 400 when page is not a valid number', async () => {
    const req = new NextRequest('http://localhost/api/projects?page=abc')
    const res = await GET(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  it('computes progress from tasks', async () => {
    const projectWithTasks = {
      ...SAMPLE_PROJECT,
      dynamicTasks: [
        { taskType: 'P1.1', status: 'DONE' },
        { taskType: 'P1.2', status: 'IN_PROGRESS' },
      ],
    }
    prismaMock.project.count.mockResolvedValue(1)
    prismaMock.project.findMany.mockResolvedValue([projectWithTasks] as any)

    const req = new NextRequest('http://localhost/api/projects')
    const res = await GET(req)
    const json = await res.json()
    expect(json.projects[0].progress).toBe(50)
    expect(json.projects[0].totalTasks).toBe(2)
    expect(json.projects[0].completedTasks).toBe(1)
  })
})

describe('POST /api/projects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(mockAuthUser)
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectCode: 'P-001', projectName: 'Test', clientName: 'Client', productType: 'Steel' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 403 when role is not authorized to create projects', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ...mockAuthUser, roleCode: 'R03' })

    const req = new NextRequest('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectCode: 'P-001', projectName: 'Test', clientName: 'Client', productType: 'Steel' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  it('returns 400 when required fields are missing', async () => {
    const req = new NextRequest('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectCode: 'P-001' }), // missing projectName, clientName, productType
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
    // Should contain validation error messages
    expect(json.error).toMatch(/projectName|clientName|productType/)
  })

  it('returns 400 when project code already exists', async () => {
    prismaMock.project.findUnique.mockResolvedValue(SAMPLE_PROJECT as any)

    const req = new NextRequest('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectCode: 'P-001', projectName: 'Test', clientName: 'Client', productType: 'Steel' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.error).toContain('P-001')
  })

  it('creates project and returns 201 with valid data', async () => {
    prismaMock.project.findUnique.mockResolvedValue(null)
    prismaMock.project.create.mockResolvedValue(SAMPLE_PROJECT as any)
    prismaMock.fileAttachment.findMany.mockResolvedValue([])
    prismaMock.auditLog.create.mockResolvedValue({} as any)

    const req = new NextRequest('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectCode: 'P-001', projectName: 'Test Project', clientName: 'Test Client', productType: 'Steel' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.project).toMatchObject({ projectCode: 'P-001' })
    expect(json.message).toBeTruthy()
  })
})

// ── /api/projects/options — dropdown chọn dự án (mọi vai đều thấy, KHÔNG lọc theo user) ──
describe('GET /api/projects/options', () => {
  const OPT_A = { id: 'p-a', projectCode: 'A-001', projectName: 'Alpha', status: 'ACTIVE' }
  const OPT_B = { id: 'p-b', projectCode: 'B-002', projectName: 'Beta', status: 'IN_PROGRESS' }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(mockAuthUser)
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue(null)
    const res = await optionsGET(new NextRequest('http://localhost/api/projects/options'))
    expect(res.status).toBe(401)
  })

  it('low role (R06a) sees ALL non-CLOSED projects — NOT filtered by getUserProjectIds', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ...mockAuthUser, roleCode: 'R06a' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaMock.project.findMany.mockResolvedValue([OPT_A, OPT_B] as any)

    const res = await optionsGET(new NextRequest('http://localhost/api/projects/options'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.projects).toHaveLength(2)
    // where CHỈ lọc status != CLOSED — KHÔNG có filter id theo dự án của user
    const arg = prismaMock.project.findMany.mock.calls[0][0]
    expect(arg.where).toEqual({ status: { not: 'CLOSED' } })
    expect(arg.where).not.toHaveProperty('id')
  })

  it('excludes CLOSED projects (where status != CLOSED)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaMock.project.findMany.mockResolvedValue([OPT_A] as any)
    await optionsGET(new NextRequest('http://localhost/api/projects/options'))
    expect(prismaMock.project.findMany.mock.calls[0][0].where).toEqual({ status: { not: 'CLOSED' } })
  })

  it('each item exposes ONLY {id, projectCode, projectName, status}', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaMock.project.findMany.mockResolvedValue([OPT_A] as any)
    const res = await optionsGET(new NextRequest('http://localhost/api/projects/options'))
    const body = await res.json()

    expect(Object.keys(body.projects[0]).sort()).toEqual(['id', 'projectCode', 'projectName', 'status'])
    expect(prismaMock.project.findMany.mock.calls[0][0].select).toEqual({
      id: true, projectCode: true, projectName: true, status: true,
    })
  })

  it('sorts by projectCode asc', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaMock.project.findMany.mockResolvedValue([OPT_A, OPT_B] as any)
    await optionsGET(new NextRequest('http://localhost/api/projects/options'))
    expect(prismaMock.project.findMany.mock.calls[0][0].orderBy).toEqual({ projectCode: 'asc' })
  })
})
