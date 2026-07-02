import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, logAudit, getClientIP } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createMaterialSchema } from '@/lib/schemas'
import { RBAC } from '@/lib/rbac-rules'

export const dynamic = 'force-dynamic'

const MGMT_PARAMS = ['page', 'q', 'search', 'limit', 'status', 'category', 'provisional']
const PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const isMgmt = MGMT_PARAMS.some((p) => url.searchParams.has(p))

    // ── Management / search mode (material-code admin UI) ──
    if (isMgmt) {
      const payload = await authenticateRequest(req)
      if (!payload) return unauthorizedResponse()

      const page = Math.max(1, Number(url.searchParams.get('page') || 1))
      // `search` là alias của `q` (dùng cho combobox autocomplete); `limit` tùy chọn (mặc định 20, tối đa 50)
      const q = (url.searchParams.get('q') ?? url.searchParams.get('search'))?.trim()
      const rawLimit = Number(url.searchParams.get('limit'))
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), MAX_PAGE_SIZE) : PAGE_SIZE
      const status = url.searchParams.get('status') || undefined
      const category = url.searchParams.get('category') || undefined
      const provisional = url.searchParams.get('provisional')

      const where: Record<string, unknown> = {}
      if (status) where.status = status
      if (category) where.category = category
      if (provisional === 'true') where.isProvisional = true
      if (provisional === 'false') where.isProvisional = false
      if (q) {
        where.OR = [
          { name: { contains: q, mode: 'insensitive' } },
          { materialCode: { contains: q, mode: 'insensitive' } },
          { specification: { contains: q, mode: 'insensitive' } },
          { aliases: { some: { aliasCode: { contains: q, mode: 'insensitive' } } } },
        ]
      }

      const [total, materials] = await Promise.all([
        prisma.material.count({ where }),
        prisma.material.findMany({
          where,
          select: {
            id: true, materialCode: true, name: true, unit: true, category: true, groupCode: true,
            specification: true, grade: true, currentStock: true, unitPrice: true,
            currency: true, status: true, isProvisional: true, createdByUnit: true,
            _count: { select: { aliases: true } },
          },
          orderBy: [{ isProvisional: 'desc' }, { materialCode: 'asc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
      ])

      return successResponse({
        materials: materials.map((m) => ({
          ...m,
          currentStock: Number(m.currentStock),
          unitPrice: m.unitPrice == null ? null : Number(m.unitPrice),
          aliasCount: m._count.aliases,
        })),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      })
    }

    // ── Legacy mode: flat list for autocompletes / PR matching ──
    const forMatch = url.searchParams.get('forMatch') === 'true'
    const materials = await prisma.material.findMany({
      where: forMatch ? { status: 'ACTIVE' } : { currentStock: { gt: 0 } },
      select: {
        id: true,
        materialCode: true,
        name: true,
        unit: true,
        category: true,
        groupCode: true,
        specification: true,
        grade: true,
        currentStock: true,
        ...(forMatch ? {
          stocks: {
            where: { quantity: { gt: 0 } },
            select: {
              quantity: true,
              warehouse: { select: { code: true, kind: true, projectCode: true } },
            },
          },
        } : {}),
      },
      orderBy: { category: 'asc' },
    })

    const REUSABLE_KINDS = new Set(['COMMON', 'RETURN'])

    return successResponse({
      materials: materials.map((m) => {
        const base = {
          id: m.id, materialCode: m.materialCode, name: m.name, unit: m.unit,
          category: m.category, groupCode: m.groupCode, specification: m.specification,
          grade: m.grade, currentStock: Number(m.currentStock),
        }
        if (!forMatch || !('stocks' in m)) return base
        const stocks = (m as any).stocks as { quantity: any; warehouse: { code: string; kind: string; projectCode: string | null } }[]
        let reusableStock = 0, projectStock = 0, customerStock = 0
        const projectWarehouses: { projectCode: string; warehouseCode: string; quantity: number }[] = []
        for (const s of stocks) {
          const qty = Number(s.quantity)
          const kind = s.warehouse.kind
          if (REUSABLE_KINDS.has(kind)) reusableStock += qty
          else if (kind === 'PROJECT') {
            projectStock += qty
            projectWarehouses.push({ projectCode: s.warehouse.projectCode || s.warehouse.code, warehouseCode: s.warehouse.code, quantity: qty })
          } else if (kind === 'CUSTOMER') customerStock += qty
        }
        return { ...base, reusableStock, projectStock, customerStock, projectWarehouses }
      }),
    })
  } catch (err) {
    console.error('Materials API error:', err)
    return errorResponse('Lỗi khi tải danh sách vật tư', 500)
  }
}

// POST /api/materials — Create canonical material code (admin / KTKH / warehouse)
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!RBAC.MATERIAL_CODE_ADMIN.includes(payload.roleCode)) {
      return forbiddenResponse('Bạn không có quyền tạo mã vật tư')
    }

    const result = await validateBody(req, createMaterialSchema)
    if (!result.success) return result.response
    const data = result.data

    const dup = await prisma.material.findUnique({ where: { materialCode: data.materialCode } })
    if (dup) return errorResponse(`Mã vật tư "${data.materialCode}" đã tồn tại`, 409)

    const material = await prisma.material.create({
      data: {
        materialCode: data.materialCode,
        name: data.name,
        nameEn: data.nameEn,
        unit: data.unit,
        category: data.category,
        specification: data.specification,
        grade: data.grade,
        minStock: data.minStock,
        unitPrice: data.unitPrice,
        currency: data.currency,
        status: 'ACTIVE',
      },
    })

    await logAudit(payload.userId, 'CREATE', 'Material', material.id, { materialCode: data.materialCode }, getClientIP(req))
    return successResponse({ material }, 'Đã tạo mã vật tư', 201)
  } catch (err) {
    console.error('POST /api/materials error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
