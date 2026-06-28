import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'

const ALLOWED_ROLES = ['R01', 'R02', 'R07', 'R07a', 'R09', 'R09a']

// GET /api/logistics/mdr?projectId= — MDR gate check
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ALLOWED_ROLES)) return errorResponse('Forbidden', 403)

  const projectId = new URL(req.url).searchParams.get('projectId')
  if (!projectId) return errorResponse('Thiếu projectId')

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { projectCode: true, projectName: true },
  })
  if (!project) return errorResponse('Dự án không tồn tại', 404)

  const [ncrs, checkpoints, inspections, packingLists, shipments] = await Promise.all([
    prisma.nonConformanceReport.findMany({
      where: { projectId },
      select: { id: true, ncrCode: true, status: true, severity: true, category: true },
    }),
    prisma.iTPCheckpoint.findMany({
      where: { itp: { projectId } },
      select: { id: true, status: true, activity: true, checkpointNo: true, itp: { select: { itpCode: true } } },
    }),
    prisma.inspection.findMany({
      where: { projectId },
      select: { id: true, status: true },
    }),
    prisma.packingList.findMany({
      where: { projectId },
      select: { id: true, plCode: true, status: true, totalWeight: true, totalPieces: true },
    }),
    prisma.shipment.findMany({
      where: { projectId },
      select: { id: true, shipmentCode: true, status: true },
    }),
  ])

  const openNcrs = ncrs.filter(n => n.status !== 'CLOSED' && n.status !== 'CANCELLED')
  const failedCheckpoints = checkpoints.filter(c => c.status === 'FAILED')
  const pendingCheckpoints = checkpoints.filter(c => c.status === 'PENDING')
  const failedInspections = inspections.filter(i => i.status === 'FAILED')

  const blockers: string[] = []
  if (openNcrs.length > 0) {
    blockers.push(`${openNcrs.length} NCR mở (${openNcrs.map(n => n.ncrCode).join(', ')})`)
  }
  if (failedCheckpoints.length > 0) {
    blockers.push(`${failedCheckpoints.length} ITP checkpoint FAILED`)
  }
  if (failedInspections.length > 0) {
    blockers.push(`${failedInspections.length} inspection FAILED`)
  }
  if (pendingCheckpoints.length > 0) {
    blockers.push(`${pendingCheckpoints.length} ITP checkpoint chưa kiểm`)
  }

  const canRelease = blockers.length === 0

  return successResponse({
    project,
    canRelease,
    blockers,
    summary: {
      ncr: { total: ncrs.length, open: openNcrs.length, closed: ncrs.length - openNcrs.length },
      itp: {
        total: checkpoints.length,
        passed: checkpoints.filter(c => c.status === 'PASSED' || c.status === 'DONE').length,
        failed: failedCheckpoints.length,
        pending: pendingCheckpoints.length,
      },
      inspections: {
        total: inspections.length,
        passed: inspections.filter(i => i.status === 'PASSED').length,
        failed: failedInspections.length,
      },
      packing: {
        total: packingLists.length,
        shipped: packingLists.filter(p => p.status === 'SHIPPED').length,
      },
      shipments: {
        total: shipments.length,
        received: shipments.filter(s => s.status === 'RECEIVED').length,
      },
    },
    openNcrs,
    failedCheckpoints: failedCheckpoints.map(c => ({
      id: c.id,
      checkpointNo: c.checkpointNo,
      activity: c.activity,
      itpCode: c.itp.itpCode,
    })),
  })
}
