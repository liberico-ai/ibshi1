import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'

// GET /api/design/bom — List BOMs
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId') || undefined

  const where: Record<string, unknown> = {}
  if (projectId) where.projectId = projectId

  const boms = await prisma.billOfMaterial.findMany({
    where,
    include: {
      project: { select: { projectCode: true, projectName: true } },
      items: {
        include: { material: { select: { materialCode: true, name: true, unit: true } } },
        orderBy: { sortOrder: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return successResponse({ boms })
}

// POST /api/design/bom — Create BOM
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01', 'R04', 'R02'])) {
    return errorResponse('Không có quyền tạo BOM', 403)
  }

  const body = await req.json()
  const { projectId, name, items } = body as {
    projectId: string; name: string;
    items?: Array<{ materialId: string; quantity: number; unit: string; remarks?: string }>
  }

  if (!projectId || !name) return errorResponse('Thiếu: dự án, tên BOM')

  const year = new Date().getFullYear().toString().slice(-2)
  const count = await prisma.billOfMaterial.count()
  const bomCode = `BOM-${year}-${String(count + 1).padStart(3, '0')}`

  const bom = await prisma.billOfMaterial.create({
    data: {
      bomCode, projectId, name, createdBy: user.userId,
      items: items ? {
        create: items.map((it, i) => ({
          materialId: it.materialId,
          quantity: it.quantity,
          unit: it.unit,
          remarks: it.remarks || null,
          sortOrder: i + 1,
        })),
      } : undefined,
    },
    include: { items: { include: { material: true } } },
  })

  return successResponse({ bom, message: 'Đã tạo BOM' })
}
