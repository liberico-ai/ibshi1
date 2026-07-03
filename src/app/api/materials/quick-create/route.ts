import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles, logAudit, getClientIP } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { quickCreateMaterialSchema } from '@/lib/schemas'
import { generateMaterialCode } from '@/lib/material-code'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['R01', 'R03', 'R03a', 'R05', 'R05a', 'R08', 'R08a', 'R10']

// POST /api/materials/quick-create
// Auto-generate a PROVISIONAL canonical code for a brand-new material raised in a PR.
// Any user allowed to create a PR can call this; the code stays PENDING + isProvisional
// until a code owner (R03/R05/R10) approves it via PATCH /api/materials/[id].
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!requireRoles(payload.roleCode, ALLOWED_ROLES)) return errorResponse('Forbidden', 403)

    const result = await validateBody(req, quickCreateMaterialSchema)
    if (!result.success) return result.response
    const data = result.data

    const material = await prisma.$transaction(async (tx) => {
      // up to 5 attempts in the rare case a generated code collides with a legacy one
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = await generateMaterialCode(tx, data.prefix, data.subgroup)
        const clash = await tx.material.findUnique({ where: { materialCode: code }, select: { id: true } })
        if (clash) continue
        return tx.material.create({
          data: {
            materialCode: code,
            name: data.name,
            unit: data.unit,
            category: data.prefix,
            specification: data.specification,
            unitPrice: data.estimatedUnitPrice,
            status: 'PENDING',
            isProvisional: true,
            createdByUnit: data.createdByUnit ?? payload.roleCode,
          },
        })
      }
      throw new Error('Không sinh được mã duy nhất sau 5 lần thử')
    })

    await logAudit(payload.userId, 'QUICK_CREATE', 'Material', material.id,
      { materialCode: material.materialCode, provisional: true }, getClientIP(req))

    return successResponse(
      { material, code: material.materialCode },
      `Đã tạo mã tạm ${material.materialCode} (chờ chuẩn hóa)`,
      201,
    )
  } catch (err) {
    console.error('POST /api/materials/quick-create error:', err)
    return errorResponse('Lỗi khi sinh mã vật tư', 500)
  }
}
