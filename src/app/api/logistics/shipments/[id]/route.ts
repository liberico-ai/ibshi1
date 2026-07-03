import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { updateShipmentSchema } from '@/lib/schemas'

const ALLOWED_ROLES = ['R01', 'R02', 'R05', 'R05a', 'R07', 'R07a', 'R08', 'R08a']

const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['IN_TRANSIT'],
  IN_TRANSIT: ['ARRIVED'],
  ARRIVED: ['RECEIVED'],
}

// PUT /api/logistics/shipments/[id] — update status
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ALLOWED_ROLES)) return errorResponse('Không có quyền', 403)

  const { id } = await params
  const result = await validateBody(req, updateShipmentSchema)
  if (!result.success) return result.response
  const data = result.data

  const shipment = await prisma.shipment.findUnique({ where: { id } })
  if (!shipment) return errorResponse('Chuyến không tồn tại', 404)

  if (data.status) {
    const allowed = VALID_TRANSITIONS[shipment.status]
    if (!allowed || !allowed.includes(data.status)) {
      return errorResponse(`Không thể chuyển ${shipment.status} → ${data.status}`)
    }
  }

  const updated = await prisma.shipment.update({
    where: { id },
    data: {
      ...(data.status ? { status: data.status } : {}),
      ...(data.status === 'IN_TRANSIT' ? { shippedAt: new Date() } : {}),
      ...(data.status === 'ARRIVED' ? { arrivedAt: new Date() } : {}),
      ...(data.status === 'RECEIVED' ? { receivedBy: data.receivedBy || user.userId, receivedAt: new Date() } : {}),
      ...(data.vehicleNo !== undefined ? { vehicleNo: data.vehicleNo } : {}),
      ...(data.driverName !== undefined ? { driverName: data.driverName } : {}),
      ...(data.driverPhone !== undefined ? { driverPhone: data.driverPhone } : {}),
      ...(data.destination !== undefined ? { destination: data.destination } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
    },
    include: {
      items: { include: { packingList: { select: { plCode: true, totalWeight: true, totalPieces: true } } } },
      project: { select: { projectCode: true, projectName: true } },
    },
  })

  return successResponse({
    shipment: {
      ...updated,
      totalWeight: updated.totalWeight ? Number(updated.totalWeight) : null,
      items: updated.items.map(si => ({
        ...si,
        packingList: {
          ...si.packingList,
          totalWeight: si.packingList.totalWeight ? Number(si.packingList.totalWeight) : null,
        },
      })),
    },
  })
}
