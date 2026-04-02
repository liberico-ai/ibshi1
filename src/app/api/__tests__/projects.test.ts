import { describe, it, expect, vi, beforeEach } from 'vitest'
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
  tasks: [],
}

describe('GET /api/projects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(mockAuthUser)
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue(null)

    const req = new Request('http://localhost/api/projects')
    const res = await GET(req as any)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  it('returns paginated project list', async () => {
    prismaMock.project.count.mockResolvedValue(1)
    prismaMock.project.findMany.mockResolvedValue([SAMPLE_PROJECT] as any)

    const req = new Request('http://localhost/api/projects?page=1&limit=20')
    const res = await GET(req as any)
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
    const req = new Request('http://localhost/api/projects?page=abc')
    const res = await GET(req as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  it('computes progress from tasks', async () => {
    const projectWithTasks = {
      ...SAMPLE_PROJECT,
      tasks: [
        { stepCode: 'P1.1', status: 'DONE' },
        { stepCode: 'P1.2', status: 'IN_PROGRESS' },
      ],
    }
    prismaMock.project.count.mockResolvedValue(1)
    prismaMock.project.findMany.mockResolvedValue([projectWithTasks] as any)

    const req = new Request('http://localhost/api/projects')
    const res = await GET(req as any)
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

    const req = new Request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectCode: 'P-001', projectName: 'Test', clientName: 'Client', productType: 'Steel' }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })

  it('returns 403 when role is not authorized to create projects', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ...mockAuthUser, roleCode: 'R03' })

    const req = new Request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectCode: 'P-001', projectName: 'Test', clientName: 'Client', productType: 'Steel' }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  it('returns 400 when required fields are missing', async () => {
    const req = new Request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectCode: 'P-001' }), // missing projectName, clientName, productType
    })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
    // Should contain validation error messages
    expect(json.error).toMatch(/projectName|clientName|productType/)
  })

  it('returns 400 when project code already exists', async () => {
    prismaMock.project.findUnique.mockResolvedValue(SAMPLE_PROJECT as any)

    const req = new Request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectCode: 'P-001', projectName: 'Test', clientName: 'Client', productType: 'Steel' }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.error).toContain('P-001')
  })

  it('creates project and returns 201 with valid data', async () => {
    prismaMock.project.findUnique.mockResolvedValue(null)
    prismaMock.project.create.mockResolvedValue(SAMPLE_PROJECT as any)
    prismaMock.fileAttachment.findMany.mockResolvedValue([])
    prismaMock.workflowTask.findFirst.mockResolvedValue(null)
    prismaMock.auditLog.create.mockResolvedValue({} as any)

    const req = new Request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectCode: 'P-001', projectName: 'Test Project', clientName: 'Test Client', productType: 'Steel' }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.project).toMatchObject({ projectCode: 'P-001' })
    expect(json.message).toBeTruthy()
  })
})
