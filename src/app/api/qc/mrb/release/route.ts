import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { computeMrbGate } from '@/lib/mrb-gate'

const ALLOWED_ROLES = ['R01', 'R09', 'R09a']

// POST /api/qc/mrb/release — phát hành MRB (idempotent, reissue nếu có blocker mới)
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, ALLOWED_ROLES)) return errorResponse('Forbidden', 403)

    const body = await req.json().catch(() => ({}))
    const { projectId } = body as { projectId?: string }
    if (!projectId) return errorResponse('Thiếu projectId')

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, projectCode: true, projectName: true },
    })
    if (!project) return errorResponse('Dự án không tồn tại', 404)

    const result = await prisma.$transaction(async (tx) => {
      const latest = await tx.mrbRelease.findFirst({
        where: { projectId },
        orderBy: { revision: 'desc' },
      })

      // Idempotent: đã RELEASED → trả bản cũ
      if (latest?.status === 'RELEASED') {
        return { existing: true, release: latest }
      }

      // Tính gate TRONG transaction (chống TOCTOU)
      const [ncrs, checkpoints, inspections] = await Promise.all([
        tx.nonConformanceReport.findMany({
          where: { projectId, status: { notIn: ['CLOSED', 'CANCELLED'] } },
          select: { ncrCode: true, status: true },
        }),
        tx.iTPCheckpoint.findMany({
          where: { itp: { projectId } },
          select: { id: true, status: true },
        }),
        tx.inspection.findMany({
          where: { projectId },
          select: { id: true, inspectionCode: true, type: true, status: true },
        }),
      ])

      const blockers: string[] = []
      if (ncrs.length > 0) {
        blockers.push(`${ncrs.length} NCR chưa đóng: ${ncrs.map(n => n.ncrCode).join(', ')}`)
      }
      const itpFailed = checkpoints.filter(c => c.status === 'FAILED')
      if (itpFailed.length > 0) blockers.push(`${itpFailed.length} ITP checkpoint FAILED`)
      const itpPending = checkpoints.filter(c => c.status === 'PENDING')
      if (itpPending.length > 0) blockers.push(`${itpPending.length} ITP checkpoint PENDING`)
      const inspFailed = inspections.filter(i => i.status === 'FAILED')
      if (inspFailed.length > 0) blockers.push(`${inspFailed.length} inspection FAILED`)
      const inspPending = inspections.filter(i => i.status === 'PENDING')
      if (inspPending.length > 0) blockers.push(`${inspPending.length} inspection PENDING`)
      const fatPassed = inspections.filter(i => i.type === 'FAT' && i.status === 'PASSED')
      if (fatPassed.length === 0) blockers.push('Chưa có Inspection FAT đạt (PASSED)')

      if (blockers.length > 0) {
        return { blocked: true, blockers }
      }

      const nextRevision = (latest?.revision ?? 0) + 1

      // Nếu latest tồn tại (non-RELEASED, e.g. SUPERSEDED scenario after re-open) → mark SUPERSEDED
      if (latest) {
        await tx.mrbRelease.update({
          where: { id: latest.id },
          data: { status: 'SUPERSEDED' },
        })
      }

      const snapshot = {
        inspections: inspections.length,
        inspPassed: inspections.filter(i => i.status === 'PASSED').length,
        ncrTotal: ncrs.length,
        itpTotal: checkpoints.length,
        itpPassed: checkpoints.filter(c => c.status === 'PASSED' || c.status === 'DONE').length,
        fatPassed: fatPassed.length,
      }

      const release = await tx.mrbRelease.create({
        data: {
          projectId,
          revision: nextRevision,
          status: 'RELEASED',
          snapshot,
          releasedById: user.userId,
        },
      })

      await tx.auditLog.create({
        data: {
          userId: user.userId,
          action: 'MRB_RELEASE',
          entity: 'MrbRelease',
          entityId: release.id,
          changes: { revision: nextRevision, projectCode: project.projectCode },
        },
      })

      return { existing: false, release }
    })

    if ('blocked' in result && result.blockers) {
      return errorResponse(`Không thể phát hành MRB: ${result.blockers.join('; ')}`, 422)
    }

    return successResponse({
      release: result.release,
      reused: result.existing,
    })
  } catch (err) {
    console.error('POST /api/qc/mrb/release error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
