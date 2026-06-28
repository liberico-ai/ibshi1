import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/qc/mill-certificates/[id]/trace — Traceability chain
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const { id } = await params
  const cert = await prisma.millCertificate.findUnique({
    where: { id },
    include: {
      material: { select: { id: true, materialCode: true, name: true, unit: true, currentStock: true } },
      vendor: { select: { vendorCode: true, name: true } },
    },
  })
  if (!cert) return errorResponse('Mill Certificate không tồn tại', 404)

  const [stockMovements, materialIssues, otherCerts] = await Promise.all([
    prisma.stockMovement.findMany({
      where: { materialId: cert.materialId, heatNumber: cert.heatNumber },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, type: true, quantity: true, reason: true, referenceNo: true,
        heatNumber: true, lotNumber: true, poItemId: true, createdAt: true,
      },
    }),
    prisma.materialIssue.findMany({
      where: { materialId: cert.materialId, heatNumber: cert.heatNumber },
      orderBy: { issuedAt: 'desc' },
      include: {
        workOrder: { select: { woCode: true, projectId: true } },
      },
    }),
    prisma.millCertificate.findMany({
      where: { heatNumber: cert.heatNumber, id: { not: cert.id } },
      select: { id: true, certNumber: true, materialId: true, grade: true },
    }),
  ])

  return successResponse({
    certificate: cert,
    traceability: {
      stockMovements: stockMovements.map(sm => ({
        ...sm, quantity: Number(sm.quantity),
      })),
      materialIssues: materialIssues.map(mi => ({
        ...mi, quantity: Number(mi.quantity),
      })),
      relatedCerts: otherCerts,
    },
  })
}
