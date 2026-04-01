import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/qc/mrb?projectId= — MRB compilation for project
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')
    if (!projectId) return errorResponse('Thiếu projectId')

    const [project, inspections, ncrs, certificates, itpCheckpoints, millCerts] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId }, select: { projectCode: true, projectName: true, clientName: true } }),
      prisma.inspection.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } }),
      prisma.nonConformanceReport.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } }),
      prisma.certificateRegistry.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.iTPCheckpoint.findMany({
        where: { itp: { projectId } },
        include: { itp: { select: { itpCode: true } } },
      }),
      prisma.millCertificate.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
    ])

    if (!project) return errorResponse('Dự án không tồn tại', 404)

    // Calculate summary
    const inspPassed = inspections.filter(i => i.status === 'PASSED').length
    const inspFailed = inspections.filter(i => i.status === 'FAILED').length
    const inspPending = inspections.filter(i => i.status === 'PENDING').length
    const ncrOpen = ncrs.filter(n => n.status !== 'CLOSED').length
    const itpTotal = itpCheckpoints.length
    const itpCompleted = itpCheckpoints.filter(c => c.status === 'DONE' || c.status === 'PASSED').length

    return successResponse({
      project,
      summary: {
        inspections: { total: inspections.length, passed: inspPassed, failed: inspFailed, pending: inspPending },
        ncr: { total: ncrs.length, open: ncrOpen, closed: ncrs.length - ncrOpen },
        certificates: certificates.length,
        millCertificates: millCerts.length,
        itp: { total: itpTotal, completed: itpCompleted, progress: itpTotal > 0 ? Math.round((itpCompleted / itpTotal) * 100) : 0 },
        overallStatus: inspFailed === 0 && ncrOpen === 0 && inspPending === 0 ? 'READY' : 'IN_PROGRESS',
      },
      inspections,
      ncrs,
      certificates,
      millCertificates: millCerts,
      itpCheckpoints,
    })
  } catch (err) {
    console.error('GET /api/qc/mrb error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
