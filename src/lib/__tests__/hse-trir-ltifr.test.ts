import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prismaMock } from '@/lib/__mocks__/db'

const mockAuth = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>()
  return { ...actual, authenticateRequest: (...a: unknown[]) => mockAuth(...a) }
})

import { GET as dashboardGET } from '@/app/api/hse/dashboard/route'
import { GET as manHoursGET, POST as manHoursPOST } from '@/app/api/hse/man-hours/route'

const QC_USER = { userId: 'u1', username: 'qc', roleCode: 'R09', userLevel: 2, fullName: 'QC' }
const PM_USER = { userId: 'u2', username: 'pm', roleCode: 'R02', userLevel: 2, fullName: 'PM' }

function makeReq(url: string, method = 'GET', body?: object) {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)
  return new NextRequest(url, opts)
}

function mockEmptyDashboard() {
  prismaMock.safetyIncident.findMany.mockResolvedValue([] as never)
  prismaMock.workPermit.findMany.mockResolvedValue([] as never)
  prismaMock.toolboxTalk.findMany.mockResolvedValue([] as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(QC_USER)
})

describe('TRIR / LTIFR formula', () => {
  it('recordable=3, manHours=500000 → TRIR=1.2', async () => {
    prismaMock.safetyIncident.findMany.mockResolvedValue([
      { id: '1', status: 'CLOSED', severity: 'MAJOR', incidentDate: new Date(), lostTimeDays: 0, recordable: true, projectId: 'p1' },
      { id: '2', status: 'CLOSED', severity: 'MINOR', incidentDate: new Date(), lostTimeDays: 0, recordable: true, projectId: 'p1' },
      { id: '3', status: 'CLOSED', severity: 'MINOR', incidentDate: new Date(), lostTimeDays: 0, recordable: true, projectId: 'p1' },
      { id: '4', status: 'CLOSED', severity: 'NEAR_MISS', incidentDate: new Date(), lostTimeDays: 0, recordable: false, projectId: 'p1' },
    ] as never)
    prismaMock.workPermit.findMany.mockResolvedValue([] as never)
    prismaMock.toolboxTalk.findMany.mockResolvedValue([] as never)
    prismaMock.hseManHours.aggregate.mockResolvedValue({ _sum: { manHours: 500000 }, _count: 0, _avg: { manHours: null }, _min: { manHours: null }, _max: { manHours: null } } as never)

    const res = await dashboardGET(makeReq('http://localhost/api/hse/dashboard'))
    const body = await res.json()
    expect(body.rates.trir).toBeCloseTo(1.2)
    expect(body.rates.recordableCount).toBe(3)
  })

  it('lostTime=2, manHours=1e6 → LTIFR=2.0', async () => {
    prismaMock.safetyIncident.findMany.mockResolvedValue([
      { id: '1', status: 'CLOSED', severity: 'MAJOR', incidentDate: new Date(), lostTimeDays: 5, recordable: true, projectId: 'p1' },
      { id: '2', status: 'CLOSED', severity: 'MINOR', incidentDate: new Date(), lostTimeDays: 3, recordable: false, projectId: 'p1' },
      { id: '3', status: 'CLOSED', severity: 'MINOR', incidentDate: new Date(), lostTimeDays: 0, recordable: false, projectId: 'p1' },
    ] as never)
    prismaMock.workPermit.findMany.mockResolvedValue([] as never)
    prismaMock.toolboxTalk.findMany.mockResolvedValue([] as never)
    prismaMock.hseManHours.aggregate.mockResolvedValue({ _sum: { manHours: 1000000 }, _count: 0, _avg: { manHours: null }, _min: { manHours: null }, _max: { manHours: null } } as never)

    const res = await dashboardGET(makeReq('http://localhost/api/hse/dashboard'))
    const body = await res.json()
    expect(body.rates.ltifr).toBeCloseTo(2.0)
    expect(body.rates.lostTimeCount).toBe(2)
  })

  it('manHours=0 → trir=null, ltifr=null, no throw', async () => {
    mockEmptyDashboard()
    prismaMock.hseManHours.aggregate.mockResolvedValue({ _sum: { manHours: null }, _count: 0, _avg: { manHours: null }, _min: { manHours: null }, _max: { manHours: null } } as never)

    const res = await dashboardGET(makeReq('http://localhost/api/hse/dashboard'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rates.trir).toBeNull()
    expect(body.rates.ltifr).toBeNull()
    expect(body.rates.manHours).toBe(0)
  })

  it('incident cũ recordable=false không lỗi dashboard', async () => {
    prismaMock.safetyIncident.findMany.mockResolvedValue([
      { id: '1', status: 'OPEN', severity: 'MINOR', incidentDate: new Date(), lostTimeDays: 0, recordable: false, projectId: 'p1' },
    ] as never)
    prismaMock.workPermit.findMany.mockResolvedValue([] as never)
    prismaMock.toolboxTalk.findMany.mockResolvedValue([] as never)
    prismaMock.hseManHours.aggregate.mockResolvedValue({ _sum: { manHours: null }, _count: 0, _avg: { manHours: null }, _min: { manHours: null }, _max: { manHours: null } } as never)

    const res = await dashboardGET(makeReq('http://localhost/api/hse/dashboard'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rates.recordableCount).toBe(0)
  })

  it('filter kỳ from/to', async () => {
    const jan = new Date('2026-01-15')
    const jun = new Date('2026-06-15')
    prismaMock.safetyIncident.findMany.mockResolvedValue([
      { id: '1', status: 'CLOSED', severity: 'MAJOR', incidentDate: jan, lostTimeDays: 0, recordable: true, projectId: 'p1' },
      { id: '2', status: 'CLOSED', severity: 'MINOR', incidentDate: jun, lostTimeDays: 2, recordable: true, projectId: 'p1' },
    ] as never)
    prismaMock.workPermit.findMany.mockResolvedValue([] as never)
    prismaMock.toolboxTalk.findMany.mockResolvedValue([] as never)
    prismaMock.hseManHours.aggregate.mockResolvedValue({ _sum: { manHours: 100000 }, _count: 0, _avg: { manHours: null }, _min: { manHours: null }, _max: { manHours: null } } as never)

    const res = await dashboardGET(makeReq('http://localhost/api/hse/dashboard?from=2026-06-01&to=2026-06-30'))
    const body = await res.json()
    expect(body.rates.recordableCount).toBe(1)
    expect(body.rates.lostTimeCount).toBe(1)
  })

  it('filter projectId', async () => {
    prismaMock.safetyIncident.findMany.mockResolvedValue([
      { id: '1', status: 'CLOSED', severity: 'MAJOR', incidentDate: new Date(), lostTimeDays: 0, recordable: true, projectId: 'p1' },
      { id: '2', status: 'CLOSED', severity: 'MINOR', incidentDate: new Date(), lostTimeDays: 0, recordable: true, projectId: 'p2' },
    ] as never)
    prismaMock.workPermit.findMany.mockResolvedValue([] as never)
    prismaMock.toolboxTalk.findMany.mockResolvedValue([] as never)
    prismaMock.hseManHours.aggregate.mockResolvedValue({ _sum: { manHours: 200000 }, _count: 0, _avg: { manHours: null }, _min: { manHours: null }, _max: { manHours: null } } as never)

    const res = await dashboardGET(makeReq('http://localhost/api/hse/dashboard?projectId=p1'))
    const body = await res.json()
    expect(body.rates.recordableCount).toBe(1)
  })
})

describe('POST /api/hse/man-hours RBAC', () => {
  it('R09 → 200', async () => {
    mockAuth.mockResolvedValue(QC_USER)
    prismaMock.hseManHours.findFirst.mockResolvedValue(null as never)
    prismaMock.hseManHours.create.mockResolvedValue({
      id: 'mh1', periodYear: 2026, periodMonth: 6, manHours: 50000, source: 'MANUAL',
    } as never)

    const res = await manHoursPOST(makeReq('http://localhost/api/hse/man-hours', 'POST', {
      periodYear: 2026, periodMonth: 6, manHours: 50000,
    }))
    expect(res.status).toBe(200)
  })

  it('R02 → 403', async () => {
    mockAuth.mockResolvedValue(PM_USER)

    const res = await manHoursPOST(makeReq('http://localhost/api/hse/man-hours', 'POST', {
      periodYear: 2026, periodMonth: 6, manHours: 50000,
    }))
    expect(res.status).toBe(403)
  })
})
