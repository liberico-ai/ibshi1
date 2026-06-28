import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, unauthorizedResponse } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const [incidents, permits, talks] = await Promise.all([
    prisma.safetyIncident.findMany({ select: { id: true, status: true, severity: true, incidentDate: true, lostTimeDays: true } }),
    prisma.workPermit.findMany({ select: { id: true, status: true, permitType: true, validTo: true } }),
    prisma.toolboxTalk.findMany({ select: { id: true, talkDate: true, attendees: true } }),
  ])

  const now = new Date()
  const openIncidents = incidents.filter(i => i.status !== 'CLOSED')
  const lastIncident = incidents.length > 0 ? incidents.sort((a, b) => new Date(b.incidentDate).getTime() - new Date(a.incidentDate).getTime())[0] : null
  const daysSinceLastIncident = lastIncident ? Math.floor((now.getTime() - new Date(lastIncident.incidentDate).getTime()) / (86400000)) : null
  const totalLostDays = incidents.reduce((s, i) => s + (i.lostTimeDays || 0), 0)

  const activePermits = permits.filter(p => p.status === 'ACTIVE' || p.status === 'APPROVED')
  const expiredPermits = permits.filter(p => (p.status === 'ACTIVE' || p.status === 'APPROVED') && new Date(p.validTo) < now)

  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const talksThisMonth = talks.filter(t => new Date(t.talkDate) >= thisMonth)
  const totalAttendees = talksThisMonth.reduce((s, t) => s + t.attendees, 0)

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
  })
}
