import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { renewCertificateSchema } from '@/lib/schemas'

// POST /api/qc/certificates/[id]/renew — Renew a certificate
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01', 'R09', 'R09a'])) {
    return errorResponse('Không có quyền gia hạn chứng chỉ', 403)
  }

  const { id } = await params
  const result = await validateBody(req, renewCertificateSchema)
  if (!result.success) return result.response
  const { certNumber, issueDate, expiryDate, fileUrl } = result.data

  const oldCert = await prisma.certificateRegistry.findUnique({ where: { id } })
  if (!oldCert) return errorResponse('Chứng chỉ không tồn tại', 404)

  const [newCert] = await prisma.$transaction([
    prisma.certificateRegistry.create({
      data: {
        certType: oldCert.certType,
        certNumber,
        holderName: oldCert.holderName,
        holderId: oldCert.holderId,
        issuedBy: oldCert.issuedBy,
        issueDate: new Date(issueDate),
        expiryDate: new Date(expiryDate),
        standard: oldCert.standard,
        scope: oldCert.scope,
        fileUrl: fileUrl || null,
        renewedFromId: oldCert.id,
      },
    }),
    prisma.certificateRegistry.update({
      where: { id },
      data: { isActive: false },
    }),
  ])

  return successResponse({ certificate: newCert, message: 'Đã gia hạn chứng chỉ' })
}
