import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createBomSchema } from '@/lib/schemas'
import { enrichBomPrItems } from '@/lib/bompr-enrich'

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

  const result = await validateBody(req, createBomSchema)
  if (!result.success) return result.response
  const { projectId, name, items } = result.data

  // ── Resolve materialId cho các item BOM thô thiếu materialId ──
  // BomItem.materialId trong DB là NOT NULL → mỗi item BẮT BUỘC có materialId khi insert.
  // Với item thiếu materialId: gọi enrichBomPrItems (chế độ tạo provisional, KHÔNG matchOnly)
  // → khớp Material Master (gắn materialId) hoặc tạo material provisional (có materialId thật).
  // Item nào vẫn không resolve được (thiếu cả profile lẫn description) → báo lỗi liệt kê rõ, KHÔNG nuốt.
  let resolvedItems = items ?? []
  if (items && items.some((it) => !it.materialId)) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { projectCode: true },
    })

    // Map item BOM → shape PrItem mà enrichBomPrItems nhận (mirror FE BomPrUploadUI)
    const prItems = items.map((it) => ({
      stt: '',
      description: it.description ?? '',
      profile: it.profile ?? '',
      grade: it.grade ?? '',
      unit: it.unit,
      quantity: Number(it.quantity),
      weight: it.weight ?? 0,
      unitWeight: it.unitWeight ?? 0,
      thickness: it.thickness ?? 0,
      length: it.length ?? 0,
      width: it.width ?? 0,
      canonicalCode: it.canonicalCode,
      materialId: it.materialId,
    }))

    // KHÔNG matchOnly → enrich sẽ TẠO provisional material để item không khớp vẫn có materialId thật
    const enriched = await enrichBomPrItems(prItems, project?.projectCode ?? undefined)

    resolvedItems = items.map((it, i) => ({
      ...it,
      materialId: it.materialId || enriched[i]?.materialId,
    }))

    const unresolved: string[] = []
    resolvedItems.forEach((it, i) => {
      if (!it.materialId) {
        const src = items[i]
        const label = src.canonicalCode || src.profile || src.description || ''
        unresolved.push(`dòng ${i + 1}${label ? ` (${label})` : ''}`)
      }
    })
    if (unresolved.length > 0) {
      return errorResponse(
        `Không resolve được materialId cho ${unresolved.length} item: ${unresolved.join('; ')}. ` +
          'Cung cấp profile/grade hoặc description để khớp Material Master, hoặc chọn vật tư trực tiếp.',
        400,
      )
    }
  }

  const year = new Date().getFullYear().toString().slice(-2)
  const count = await prisma.billOfMaterial.count()
  const bomCode = `BOM-${year}-${String(count + 1).padStart(3, '0')}`

  const bom = await prisma.billOfMaterial.create({
    data: {
      bomCode, projectId, name, createdBy: user.userId,
      items: resolvedItems.length ? {
        create: resolvedItems.map((it, i) => ({
          materialId: it.materialId as string, // đã resolve (non-null) — đã chặn ở trên
          quantity: it.quantity,
          unit: it.unit,
          profile: it.profile || null,
          grade: it.grade || null,
          remarks: it.remarks || null,
          sortOrder: i + 1,
        })),
      } : undefined,
    },
    include: { items: { include: { material: true } } },
  })

  return successResponse({ bom, message: 'Đã tạo BOM' })
}
