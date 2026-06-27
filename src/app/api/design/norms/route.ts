import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { z } from 'zod'

const NORM_CATEGORIES = ['WELD', 'PAINT', 'CONSUMABLE'] as const

const createNormSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1),
  category: z.enum(NORM_CATEGORIES),
  unit: z.string().min(1),
  rate: z.number().positive(),
  basisUnit: z.string().min(1),
  projectId: z.string().optional().nullable(),
  materialId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

// GET /api/design/norms — List norms
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId') || undefined
  const category = url.searchParams.get('category') || undefined

  const where: Record<string, unknown> = {}
  if (projectId) where.projectId = projectId
  if (category) {
    if (!NORM_CATEGORIES.includes(category as (typeof NORM_CATEGORIES)[number])) {
      return errorResponse('category phải là WELD, PAINT hoặc CONSUMABLE', 400)
    }
    where.category = category
  }

  const norms = await prisma.norm.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  })

  return successResponse({ norms })
}

// POST /api/design/norms — Create norm
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01', 'R03', 'R03a'])) {
    return errorResponse('Không có quyền tạo định mức', 403)
  }

  const result = await validateBody(req, createNormSchema)
  if (!result.success) return result.response
  const { code, name, category, unit, rate, basisUnit, projectId, materialId, notes } = result.data

  let normCode = code
  if (!normCode) {
    const count = await prisma.norm.count({ where: { category } })
    normCode = `NORM-${category}-${count + 1}`
  }

  // Check uniqueness
  const existing = await prisma.norm.findUnique({ where: { code: normCode } })
  if (existing) {
    return errorResponse(`Mã định mức "${normCode}" đã tồn tại`, 409)
  }

  const norm = await prisma.norm.create({
    data: {
      code: normCode,
      name,
      category,
      unit,
      rate,
      basisUnit,
      projectId: projectId || null,
      materialId: materialId || null,
      notes: notes || null,
    },
  })

  return successResponse({ norm, message: 'Đã tạo định mức' })
}
