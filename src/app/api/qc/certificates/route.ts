import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createCertificateSchema } from '@/lib/schemas'

// GET /api/qc/certificates — List certificates
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const certType = url.searchParams.get('certType') || undefined

  const where: Record<string, unknown> = {}
  if (certType) where.certType = certType

  const certificates = await prisma.certificateRegistry.findMany({
    where,
    orderBy: { expiryDate: 'asc' },
  })

  const now = new Date()
  const result = certificates.map(cert => ({
    ...cert,
    daysToExpiry: Math.ceil((new Date(cert.expiryDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
    isExpired: new Date(cert.expiryDate) < now,
    isExpiringSoon: new Date(cert.expiryDate) < new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
  }))

  return successResponse({ certificates: result })
}

// POST /api/qc/certificates — Create certificate
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01', 'R09', 'R09a'])) {
    return errorResponse('Không có quyền tạo chứng chỉ', 403)
  }

  const result = await validateBody(req, createCertificateSchema)
  if (!result.success) return result.response
  const { certType, certNumber, holderName, holderId, issuedBy, issueDate, expiryDate, standard, scope } = result.data

  const cert = await prisma.certificateRegistry.create({
    data: {
      certType, certNumber, holderName,
      holderId: holderId || null,
      issuedBy, issueDate: new Date(issueDate), expiryDate: new Date(expiryDate),
      standard: standard || null, scope: scope || null,
    },
  })

  return successResponse({ certificate: cert, message: 'Đã tạo chứng chỉ' })
}
