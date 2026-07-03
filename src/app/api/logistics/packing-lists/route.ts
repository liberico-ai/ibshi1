import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { getPieceMarkQcStatus } from '@/lib/qc-gate'
import { validateBody } from '@/lib/api-helpers'
import { createPackingListSchema } from '@/lib/schemas'

const ALLOWED_ROLES = ['R01', 'R02', 'R05', 'R05a', 'R07', 'R07a', 'R08', 'R08a']

// GET /api/logistics/packing-lists
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId') || undefined
  const status = url.searchParams.get('status') || undefined

  const where: Record<string, unknown> = {}
  if (projectId) where.projectId = projectId
  if (status) where.status = status

  const packingLists = await prisma.packingList.findMany({
    where,
    include: {
      items: {
        include: {
          workOrder: { select: { woCode: true, pieceMark: true, plannedWeight: true } },
        },
      },
      project: { select: { projectCode: true, projectName: true } },
      shipmentItems: { select: { shipment: { select: { shipmentCode: true, status: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const result = packingLists.map(pl => ({
    ...pl,
    totalWeight: pl.totalWeight ? Number(pl.totalWeight) : null,
    items: pl.items.map(it => ({
      ...it,
      weight: it.weight ? Number(it.weight) : null,
      workOrder: {
        ...it.workOrder,
        plannedWeight: it.workOrder.plannedWeight ? Number(it.workOrder.plannedWeight) : null,
      },
    })),
  }))

  return successResponse({ packingLists: result })
}

// POST /api/logistics/packing-lists — QC gate enforced
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ALLOWED_ROLES)) return errorResponse('Không có quyền', 403)

  const result = await validateBody(req, createPackingListSchema)
  if (!result.success) return result.response
  const data = result.data

  // QC gate: check each WO via qc-gate helper (C1/C2/C3 — covers weld + non-weld)
  const blocked: string[] = []
  const itemStatuses: Map<string, string> = new Map()
  for (const item of data.items) {
    const status = await getPieceMarkQcStatus(item.workOrderId)
    itemStatuses.set(item.workOrderId, status)
    if (status !== 'PASSED') {
      blocked.push(`${item.pieceMark} (WO ${item.workOrderId}) — QC: ${status}`)
    }
  }

  if (blocked.length > 0) {
    return errorResponse(`QC chưa đạt — không thể gom kiện: ${blocked.join('; ')}`, 422)
  }

  const count = await prisma.packingList.count()
  const plCode = `PL-${String(count + 1).padStart(5, '0')}`

  const totalWeight = data.items.reduce((sum, it) => sum + (it.weight || 0), 0)
  const totalPieces = data.items.reduce((sum, it) => sum + (it.quantity || 1), 0)

  const pl = await prisma.packingList.create({
    data: {
      plCode,
      projectId: data.projectId,
      totalWeight: totalWeight || null,
      totalPieces,
      dimensions: data.dimensions || null,
      notes: data.notes || null,
      createdBy: user.userId,
      items: {
        create: data.items.map(it => ({
          workOrderId: it.workOrderId,
          pieceMark: it.pieceMark,
          description: it.description || null,
          weight: it.weight || null,
          quantity: it.quantity || 1,
          qcStatus: itemStatuses.get(it.workOrderId) || 'PASSED',
        })),
      },
    },
    include: {
      items: true,
      project: { select: { projectCode: true, projectName: true } },
    },
  })

  return successResponse({ packingList: pl, message: `Kiện ${plCode} đã tạo` }, undefined, 201)
}
