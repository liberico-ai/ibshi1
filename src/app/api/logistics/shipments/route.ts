import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createShipmentSchema } from '@/lib/schemas'

const ALLOWED_ROLES = ['R01', 'R02', 'R05', 'R05a', 'R07', 'R07a']

// GET /api/logistics/shipments
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId') || undefined
  const status = url.searchParams.get('status') || undefined

  const where: Record<string, unknown> = {}
  if (projectId) where.projectId = projectId
  if (status) where.status = status

  const shipments = await prisma.shipment.findMany({
    where,
    include: {
      items: {
        include: {
          packingList: {
            select: {
              plCode: true,
              totalWeight: true,
              totalPieces: true,
              items: { select: { pieceMark: true, weight: true, quantity: true } },
            },
          },
        },
      },
      project: { select: { projectCode: true, projectName: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const result = shipments.map(s => ({
    ...s,
    totalWeight: s.totalWeight ? Number(s.totalWeight) : null,
    items: s.items.map(si => ({
      ...si,
      packingList: {
        ...si.packingList,
        totalWeight: si.packingList.totalWeight ? Number(si.packingList.totalWeight) : null,
        items: si.packingList.items.map(pli => ({
          ...pli,
          weight: pli.weight ? Number(pli.weight) : null,
        })),
      },
    })),
  }))

  return successResponse({ shipments: result })
}

// POST /api/logistics/shipments
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ALLOWED_ROLES)) return errorResponse('Không có quyền', 403)

  const result = await validateBody(req, createShipmentSchema)
  if (!result.success) return result.response
  const data = result.data

  // Validate packing lists exist and are DRAFT (not yet shipped)
  const pls = await prisma.packingList.findMany({
    where: { id: { in: data.packingListIds } },
    select: { id: true, plCode: true, status: true, totalWeight: true, totalPieces: true },
  })

  if (pls.length !== data.packingListIds.length) {
    return errorResponse('Một hoặc nhiều kiện không tồn tại')
  }

  const alreadyShipped = pls.filter(pl => pl.status === 'SHIPPED')
  if (alreadyShipped.length > 0) {
    return errorResponse(`Kiện đã xuất: ${alreadyShipped.map(p => p.plCode).join(', ')}`)
  }

  const count = await prisma.shipment.count()
  const shipmentCode = `SH-${String(count + 1).padStart(5, '0')}`

  const totalWeight = pls.reduce((sum, pl) => sum + (pl.totalWeight ? Number(pl.totalWeight) : 0), 0)
  const totalPieces = pls.reduce((sum, pl) => sum + pl.totalPieces, 0)

  const shipment = await prisma.$transaction(async (tx) => {
    const sh = await tx.shipment.create({
      data: {
        shipmentCode,
        projectId: data.projectId,
        vehicleNo: data.vehicleNo || null,
        driverName: data.driverName || null,
        driverPhone: data.driverPhone || null,
        destination: data.destination || null,
        totalWeight: totalWeight || null,
        totalPieces,
        notes: data.notes || null,
        createdBy: user.userId,
        items: {
          create: data.packingListIds.map(plId => ({
            packingListId: plId,
          })),
        },
      },
      include: {
        items: { include: { packingList: { select: { plCode: true } } } },
        project: { select: { projectCode: true, projectName: true } },
      },
    })

    // Mark packing lists as SHIPPED
    await tx.packingList.updateMany({
      where: { id: { in: data.packingListIds } },
      data: { status: 'SHIPPED' },
    })

    return sh
  })

  return successResponse({ shipment, message: `Chuyến ${shipmentCode} đã tạo` }, undefined, 201)
}
