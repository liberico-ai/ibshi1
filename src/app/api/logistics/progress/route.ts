import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/logistics/progress — delivery progress by tons & piece-marks
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId') || undefined

  const plWhere: Record<string, unknown> = {}
  const shWhere: Record<string, unknown> = {}
  if (projectId) { plWhere.projectId = projectId; shWhere.projectId = projectId }

  const [packingLists, shipments, workOrders] = await Promise.all([
    prisma.packingList.findMany({
      where: plWhere,
      include: { items: { select: { weight: true, quantity: true, pieceMark: true } } },
    }),
    prisma.shipment.findMany({
      where: shWhere,
      include: {
        items: {
          include: {
            packingList: {
              select: { items: { select: { weight: true, quantity: true, pieceMark: true } } },
            },
          },
        },
      },
    }),
    prisma.workOrder.findMany({
      where: projectId ? { projectId } : {},
      select: { plannedWeight: true, pieceMark: true },
    }),
  ])

  // Total planned
  const totalPlannedTons = workOrders.reduce((s, wo) => s + (wo.plannedWeight ? Number(wo.plannedWeight) / 1000 : 0), 0)
  const totalPieceMarks = workOrders.filter(wo => wo.pieceMark).length

  // Packed
  const packedWeight = packingLists.reduce((s, pl) =>
    s + pl.items.reduce((is, it) => is + (it.weight ? Number(it.weight) : 0), 0), 0)
  const packedPieces = packingLists.reduce((s, pl) =>
    s + pl.items.reduce((is, it) => is + it.quantity, 0), 0)

  // Shipped (IN_TRANSIT or beyond)
  const shippedShipments = shipments.filter(s => s.status !== 'PENDING')
  const shippedWeight = shippedShipments.reduce((s, sh) =>
    s + sh.items.reduce((is, si) =>
      is + si.packingList.items.reduce((ps, pi) => ps + (pi.weight ? Number(pi.weight) : 0), 0), 0), 0)
  const shippedPieces = shippedShipments.reduce((s, sh) =>
    s + sh.items.reduce((is, si) =>
      is + si.packingList.items.reduce((ps, pi) => ps + pi.quantity, 0), 0), 0)

  // Arrived/Received
  const arrivedShipments = shipments.filter(s => s.status === 'ARRIVED' || s.status === 'RECEIVED')
  const arrivedWeight = arrivedShipments.reduce((s, sh) =>
    s + sh.items.reduce((is, si) =>
      is + si.packingList.items.reduce((ps, pi) => ps + (pi.weight ? Number(pi.weight) : 0), 0), 0), 0)

  return successResponse({
    totalPlannedTons: Math.round(totalPlannedTons * 100) / 100,
    totalPieceMarks,
    packed: { weight: Math.round(packedWeight), pieces: packedPieces },
    shipped: { weight: Math.round(shippedWeight), pieces: shippedPieces },
    arrived: { weight: Math.round(arrivedWeight) },
    packingListCount: packingLists.length,
    shipmentCount: shipments.length,
    shipmentsByStatus: {
      pending: shipments.filter(s => s.status === 'PENDING').length,
      inTransit: shipments.filter(s => s.status === 'IN_TRANSIT').length,
      arrived: shipments.filter(s => s.status === 'ARRIVED').length,
      received: shipments.filter(s => s.status === 'RECEIVED').length,
    },
  })
}
