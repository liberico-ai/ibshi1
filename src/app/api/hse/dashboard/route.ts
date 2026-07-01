import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, unauthorizedResponse } from '@/lib/auth'
import { todayStart } from '@/lib/utils'

export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const projectId = url.searchParams.get('projectId')

  const [incidents, permits, talks] = await Promise.all([
    prisma.safetyIncident.findMany({ select: { id: true, status: true, severity: true, incidentDate: true, lostTimeDays: true, recordable: true, projectId: true } }),
    prisma.workPermit.findMany({ select: { id: true, status: true, permitType: true, validTo: true } }),
    prisma.toolboxTalk.findMany({ select: { id: true, talkDate: true, attendees: true } }),
  ])

  const today = todayStart()
  const openIncidents = incidents.filter(i => i.status !== 'CLOSED')
  const lastIncident = incidents.length > 0 ? incidents.sort((a, b) => new Date(b.incidentDate).getTime() - new Date(a.incidentDate).getTime())[0] : null
  const daysSinceLastIncident = lastIncident ? Math.floor((today.getTime() - new Date(lastIncident.incidentDate).getTime()) / 86400000) : null
  const totalLostDays = incidents.reduce((s, i) => s + (i.lostTimeDays || 0), 0)

  const activePermits = permits.filter(p => p.status === 'ACTIVE' || p.status === 'APPROVED')
  const expiredPermits = permits.filter(p => (p.status === 'ACTIVE' || p.status === 'APPROVED') && new Date(p.validTo) < today)

  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const talksThisMonth = talks.filter(t => new Date(t.talkDate) >= thisMonth)
  const totalAttendees = talksThisMonth.reduce((s, t) => s + t.attendees, 0)

  // TRIR / LTIFR calculation
  const periodFrom = from ? new Date(from) : null
  const periodTo = to ? new Date(to) : null

  let periodIncidents = incidents
  if (periodFrom) periodIncidents = periodIncidents.filter(i => new Date(i.incidentDate) >= periodFrom)
  if (periodTo) periodIncidents = periodIncidents.filter(i => new Date(i.incidentDate) <= periodTo)
  if (projectId) periodIncidents = periodIncidents.filter(i => i.projectId === projectId)

  const recordableCount = periodIncidents.filter(i => i.recordable).length
  const lostTimeCount = periodIncidents.filter(i => (i.lostTimeDays ?? 0) > 0).length

  const manHoursWhere: Record<string, unknown> = { source: 'MANUAL' }
  if (periodFrom || periodTo) {
    const yearMonthFilters: Record<string, unknown>[] = []
    if (periodFrom) {
      yearMonthFilters.push({
        OR: [
          { periodYear: { gt: periodFrom.getFullYear() } },
          { periodYear: periodFrom.getFullYear(), periodMonth: { gte: periodFrom.getMonth() + 1 } },
        ],
      })
    }
    if (periodTo) {
      yearMonthFilters.push({
        OR: [
          { periodYear: { lt: periodTo.getFullYear() } },
          { periodYear: periodTo.getFullYear(), periodMonth: { lte: periodTo.getMonth() + 1 } },
        ],
      })
    }
    manHoursWhere.AND = yearMonthFilters
  }
  if (projectId) manHoursWhere.projectId = projectId

  const manHoursAgg = await prisma.hseManHours.aggregate({
    where: manHoursWhere,
    _sum: { manHours: true },
  })
  const manHours = manHoursAgg._sum.manHours ? Number(manHoursAgg._sum.manHours) : 0

  const trir = manHours > 0 ? (recordableCount * 200000) / manHours : null
  const ltifr = manHours > 0 ? (lostTimeCount * 1000000) / manHours : null

  return successResponse({
    incidents: {
      total: incidents.length,
      open: openIncidents.length,
      bySeverity: {
        critical: incidents.filter(i => i.severity === 'CRITICAL').length,
        major: incidents.filter(i => i.severity === 'MAJOR').length,
        minor: incidents.filter(i => i.severity === 'MINOR').length,
        nearMiss: incidents.filter(i => i.severity === 'NEAR_MISS').length,
      },
      daysSinceLastIncident,
      totalLostDays,
    },
    permits: {
      total: permits.length,
      active: activePermits.length,
      expired: expiredPermits.length,
      pending: permits.filter(p => p.status === 'PENDING' || p.status === 'DRAFT').length,
    },
    toolboxTalks: {
      total: talks.length,
      thisMonth: talksThisMonth.length,
      totalAttendees,
    },
    rates: {
      recordableCount,
      lostTimeCount,
      manHours,
      manHoursSource: 'MANUAL',
      trir,
      ltifr,
    },
  })
}
