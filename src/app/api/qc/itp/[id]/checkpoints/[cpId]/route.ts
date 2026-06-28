import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { updateCheckpointSchema } from '@/lib/schemas'

// PUT /api/qc/itp/[id]/checkpoints/[cpId] — Update checkpoint status
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; cpId: string }> }
) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01', 'R09', 'R09a'])) {
    return errorResponse('Không có quyền cập nhật checkpoint', 403)
  }

  const { id: itpId, cpId } = await params
  const result = await validateBody(req, updateCheckpointSchema)
  if (!result.success) return result.response
  const { status, remarks, createNcr } = result.data

  try {
    const checkpoint = await prisma.iTPCheckpoint.findFirst({
      where: { id: cpId, itpId },
      include: { itp: { select: { projectId: true, name: true } } },
    })
    if (!checkpoint) return errorResponse('Checkpoint không tồn tại', 404)

    let ncrId: string | null = null

    if (status === 'FAILED' && createNcr) {
      const year = new Date().getFullYear().toString().slice(-2)
      const count = await prisma.nonConformanceReport.count()
      const ncrCode = `NCR-${year}-${String(count + 1).padStart(3, '0')}`

      const ncr = await prisma.nonConformanceReport.create({
        data: {
          ncrCode,
          projectId: checkpoint.itp.projectId,
          category: 'process',
          severity: checkpoint.inspectionType === 'HOLD' ? 'MAJOR' : 'MINOR',
          description: `ITP checkpoint #${checkpoint.checkpointNo} FAILED: ${checkpoint.activity}${remarks ? ` — ${remarks}` : ''}`,
          raisedBy: user.userId,
        },
      })
      ncrId = ncr.id
    }

    const updated = await prisma.iTPCheckpoint.update({
      where: { id: cpId },
      data: {
        status,
        inspectedBy: user.userId,
        inspectedAt: new Date(),
        remarks: remarks || null,
        ...(ncrId ? { ncrId } : {}),
      },
    })

    const allCheckpoints = await prisma.iTPCheckpoint.findMany({
      where: { itpId },
      select: { status: true },
    })

    const total = allCheckpoints.length
    const passed = allCheckpoints.filter(c => c.status === 'PASSED').length
    const failed = allCheckpoints.filter(c => c.status === 'FAILED').length
    const pending = allCheckpoints.filter(c => c.status === 'PENDING').length

    let itpStatus: string
    if (total > 0 && pending === 0 && failed === 0) itpStatus = 'COMPLETED'
    else if (passed > 0 || failed > 0) itpStatus = 'IN_PROGRESS'
    else itpStatus = 'DRAFT'

    await prisma.inspectionTestPlan.update({
      where: { id: itpId },
      data: { status: itpStatus },
    })

    return successResponse({
      checkpoint: updated,
      itpStatus,
      ncrId,
      progress: { total, passed, failed, pending },
    })
  } catch (err: unknown) {
    return errorResponse(err instanceof Error ? err.message : 'Lỗi server', 500)
  }
}
