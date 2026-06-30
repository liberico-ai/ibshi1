import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles, logAudit, getClientIP } from '@/lib/auth'
import { validateBody, validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'
import { z } from 'zod'

const NORM_ROLES = ['R01', 'R03', 'R03a']

const updateNormSchema = z.object({
  name: z.string().min(1).optional(),
  unit: z.string().min(1).optional(),
  rate: z.number().positive().optional(),
  basisUnit: z.string().min(1).optional(),
  notes: z.string().optional().nullable(),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const pResult = validateParams(await params, idParamSchema)
  if (!pResult.success) return pResult.response

  const norm = await prisma.norm.findUnique({ where: { id: pResult.data.id } })
  if (!norm) return errorResponse('Không tìm thấy định mức', 404)

  return successResponse({ norm })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, NORM_ROLES)) {
    return errorResponse('Chỉ KTKH hoặc BGĐ được sửa định mức', 403)
  }

  const pResult = validateParams(await params, idParamSchema)
  if (!pResult.success) return pResult.response
  const { id } = pResult.data

  const bodyResult = await validateBody(req, updateNormSchema)
  if (!bodyResult.success) return bodyResult.response

  const existing = await prisma.norm.findUnique({ where: { id } })
  if (!existing) return errorResponse('Không tìm thấy định mức', 404)

  const norm = await prisma.norm.update({
    where: { id },
    data: bodyResult.data,
  })

  await logAudit(user.userId, 'UPDATE', 'Norm', id,
    { code: norm.code, ...bodyResult.data }, getClientIP(req))

  return successResponse({ norm, message: `Đã cập nhật định mức ${norm.code}` })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01'])) {
    return errorResponse('Chỉ BGĐ được xóa định mức', 403)
  }

  const pResult = validateParams(await params, idParamSchema)
  if (!pResult.success) return pResult.response
  const { id } = pResult.data

  const existing = await prisma.norm.findUnique({ where: { id } })
  if (!existing) return errorResponse('Không tìm thấy định mức', 404)

  await prisma.norm.delete({ where: { id } })

  await logAudit(user.userId, 'DELETE', 'Norm', id,
    { code: existing.code, name: existing.name }, getClientIP(req))

  return successResponse({ message: `Đã xóa định mức ${existing.code}` })
}
