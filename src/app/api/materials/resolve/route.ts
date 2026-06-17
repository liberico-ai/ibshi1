import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET /api/materials/resolve?code=XXX
// Resolve ANY code (canonical or legacy alias) to the canonical material.
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const code = new URL(req.url).searchParams.get('code')?.trim()
    if (!code) return errorResponse('Thiếu tham số code', 400)

    // 1) try canonical code
    let material = await prisma.material.findUnique({
      where: { materialCode: code },
      include: { aliases: true },
    })
    let resolvedFrom: 'canonical' | 'alias' = 'canonical'

    // 2) fall back to alias lookup
    if (!material) {
      const alias = await prisma.materialCodeAlias.findUnique({
        where: { aliasCode: code },
        include: { material: { include: { aliases: true } } },
      })
      if (alias) {
        material = alias.material
        resolvedFrom = 'alias'
      }
    }

    if (!material) return errorResponse('Không tìm thấy vật tư với mã này', 404)

    return successResponse({
      resolvedFrom,
      material: {
        ...material,
        currentStock: Number(material.currentStock),
        reservedStock: Number(material.reservedStock),
        unitPrice: material.unitPrice == null ? null : Number(material.unitPrice),
      },
    })
  } catch (err) {
    console.error('GET /api/materials/resolve error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
