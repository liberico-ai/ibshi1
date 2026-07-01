import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { updateWeldJointSchema } from '@/lib/schemas'
import { isCertValid } from '@/lib/weld-cert-gate'

// PUT /api/production/weld-map/[id] — Update weld joint status/NDT
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01', 'R06', 'R06a', 'R06b', 'R09', 'R09a'])) {
    return errorResponse('Không có quyền', 403)
  }

  const { id } = await params
  const result = await validateBody(req, updateWeldJointSchema)
  if (!result.success) return result.response
  const data = result.data

  const joint = await prisma.weldJoint.findUnique({ where: { id } })
  if (!joint) return errorResponse('Mối hàn không tồn tại', 404)

  if (data.welderCertId) {
    const check = await isCertValid(data.welderCertId, 'welder_cert', data.welderId ?? joint.welderId)
    if (!check.valid) return errorResponse(check.reason!, 400)
  }
  if (data.wpsCertId) {
    const check = await isCertValid(data.wpsCertId, 'wps')
    if (!check.valid) return errorResponse(check.reason!, 400)
  }

  if (data.status === 'WELDED') {
    const certId = data.welderCertId ?? joint.welderCertId
    if (certId) {
      const check = await isCertValid(certId, 'welder_cert', data.welderId ?? joint.welderId)
      if (!check.valid) return errorResponse(`Không thể đánh dấu WELDED: ${check.reason}`, 400)
    }
    const wpsId = data.wpsCertId ?? joint.wpsCertId
    if (wpsId) {
      const check = await isCertValid(wpsId, 'wps')
      if (!check.valid) return errorResponse(`Không thể đánh dấu WELDED: ${check.reason}`, 400)
    }
  }

  let ncrId = data.ncrId ?? undefined

  // NDT FAILED + no NCR → auto-create NCR
  if (data.ndtStatus === 'FAILED' && !joint.ncrId && !ncrId) {
    const wo = await prisma.workOrder.findUnique({
      where: { id: joint.workOrderId },
      select: { projectId: true, woCode: true },
    })
    if (wo) {
      const year = new Date().getFullYear().toString().slice(-2)
      const count = await prisma.nonConformanceReport.count()
      const ncrCode = `NCR-${year}-${String(count + 1).padStart(3, '0')}`

      const ncr = await prisma.nonConformanceReport.create({
        data: {
          ncrCode,
          projectId: wo.projectId,
          category: 'welding',
          severity: 'MAJOR',
          description: `Weld joint ${joint.jointNo} (${wo.woCode}) NDT FAILED — ${data.ndtMethod || joint.ndtMethod || 'NDT'}`,
          raisedBy: user.userId,
        },
      })
      ncrId = ncr.id
    }
  }

  const updated = await prisma.weldJoint.update({
    where: { id },
    data: {
      ...(data.status ? { status: data.status, ...(data.status === 'WELDED' ? { weldedAt: new Date() } : {}) } : {}),
      ...(data.wpsNo !== undefined ? { wpsNo: data.wpsNo } : {}),
      ...(data.welderId !== undefined ? { welderId: data.welderId } : {}),
      ...(data.welderCertId !== undefined ? { welderCertId: data.welderCertId } : {}),
      ...(data.wpsCertId !== undefined ? { wpsCertId: data.wpsCertId } : {}),
      ...(data.ndtStatus ? { ndtStatus: data.ndtStatus } : {}),
      ...(data.ndtMethod !== undefined ? { ndtMethod: data.ndtMethod } : {}),
      ...(ncrId ? { ncrId } : {}),
      ...(data.remarks !== undefined ? { remarks: data.remarks } : {}),
    },
    include: {
      welder: { select: { id: true, fullName: true } },
      ncr: { select: { id: true, ncrCode: true, status: true } },
    },
  })

  return successResponse({
    joint: {
      ...updated,
      diameter: updated.diameter ? Number(updated.diameter) : null,
      thickness: updated.thickness ? Number(updated.thickness) : null,
      length: updated.length ? Number(updated.length) : null,
    },
  })
}
