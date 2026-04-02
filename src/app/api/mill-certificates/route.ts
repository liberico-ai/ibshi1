import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createMillCertSchema } from '@/lib/schemas'

// GET /api/mill-certificates — list mill certificates
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const vendorId = searchParams.get('vendorId')
    const verified = searchParams.get('verified')

    const where: Record<string, unknown> = {}
    if (vendorId) where.vendorId = vendorId
    if (verified !== null && verified !== '') where.isVerified = verified === 'true'

    const certs = await prisma.millCertificate.findMany({
      where,
      include: {
        material: { select: { materialCode: true, name: true } },
        vendor: { select: { vendorCode: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    const verifiedCount = certs.filter(c => c.isVerified).length

    return successResponse({
      certificates: certs,
      total: certs.length,
      stats: { verified: verifiedCount, unverified: certs.length - verifiedCount },
    })
  } catch (err) {
    console.error('GET /api/mill-certificates error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/mill-certificates — create mill certificate
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const result = await validateBody(req, createMillCertSchema)
    if (!result.success) return result.response
    const { certNumber, materialId, vendorId, heatNumber, grade, thickness } = result.data

    const exists = await prisma.millCertificate.findUnique({ where: { certNumber } })
    if (exists) return errorResponse(`Số chứng chỉ ${certNumber} đã tồn tại`)

    const cert = await prisma.millCertificate.create({
      data: {
        certNumber, materialId, vendorId, heatNumber,
        grade: grade || null, thickness: thickness || null,
      },
    })

    return successResponse({ certificate: cert }, 'Tạo Mill Certificate thành công')
  } catch (err) {
    console.error('POST /api/mill-certificates error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
