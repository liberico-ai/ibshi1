import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createWeldJointSchema } from '@/lib/schemas'

// GET /api/production/weld-map — List weld joints
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const woId = url.searchParams.get('workOrderId') || undefined
  const status = url.searchParams.get('status') || undefined
  const ndtStatus = url.searchParams.get('ndtStatus') || undefined

  const where: Record<string, unknown> = {}
  if (woId) where.workOrderId = woId
  if (status) where.status = status
  if (ndtStatus) where.ndtStatus = ndtStatus

  const joints = await prisma.weldJoint.findMany({
    where,
    include: {
      workOrder: { select: { woCode: true, pieceMark: true } },
      welder: { select: { id: true, fullName: true } },
      ncr: { select: { id: true, ncrCode: true, status: true } },
    },
    orderBy: { jointNo: 'asc' },
  })

  const result = joints.map(j => ({
    ...j,
    diameter: j.diameter ? Number(j.diameter) : null,
    thickness: j.thickness ? Number(j.thickness) : null,
    length: j.length ? Number(j.length) : null,
  }))

  const stats = {
    total: joints.length,
    welded: joints.filter(j => j.status === 'WELDED' || j.status === 'REPAIRED').length,
    pending: joints.filter(j => j.status === 'PENDING').length,
    ndtPassed: joints.filter(j => j.ndtStatus === 'PASSED').length,
    ndtFailed: joints.filter(j => j.ndtStatus === 'FAILED').length,
  }

  return successResponse({ joints: result, stats })
}

// POST /api/production/weld-map — Create weld joint
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01', 'R06', 'R06a', 'R06b', 'R09', 'R09a'])) {
    return errorResponse('Không có quyền', 403)
  }

  const result = await validateBody(req, createWeldJointSchema)
  if (!result.success) return result.response
  const data = result.data

  const wo = await prisma.workOrder.findUnique({ where: { id: data.workOrderId } })
  if (!wo) return errorResponse('WO không tồn tại', 404)

  const joint = await prisma.weldJoint.create({
    data: {
      workOrderId: data.workOrderId,
      jointNo: data.jointNo,
      jointType: data.jointType || 'BUTT',
      wpsNo: data.wpsNo || null,
      welderId: data.welderId || null,
      welderCertId: data.welderCertId || null,
      diameter: data.diameter || null,
      thickness: data.thickness || null,
      length: data.length || null,
      remarks: data.remarks || null,
    },
    include: {
      welder: { select: { id: true, fullName: true } },
    },
  })

  return successResponse({ joint, message: 'Đã thêm mối hàn' })
}
