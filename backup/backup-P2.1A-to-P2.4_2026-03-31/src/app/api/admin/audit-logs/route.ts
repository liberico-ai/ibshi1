import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse } from '@/lib/auth'

const ADMIN_ROLES = ['R01', 'R10']

// GET /api/admin/audit-logs — Paginated, filterable audit logs
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!ADMIN_ROLES.includes(payload.roleCode)) return forbiddenResponse()

    const url = new URL(req.url)
    const page = parseInt(url.searchParams.get('page') || '1')
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100)
    const search = url.searchParams.get('search') || ''
    const action = url.searchParams.get('action') || ''
    const entity = url.searchParams.get('entity') || ''
    const userId = url.searchParams.get('userId') || ''
    const dateFrom = url.searchParams.get('dateFrom') || ''
    const dateTo = url.searchParams.get('dateTo') || ''

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {}

    if (action) where.action = action
    if (entity) where.entity = { contains: entity, mode: 'insensitive' }
    if (userId) where.userId = userId

    if (dateFrom || dateTo) {
      where.createdAt = {}
      if (dateFrom) where.createdAt.gte = new Date(dateFrom)
      if (dateTo) where.createdAt.lte = new Date(dateTo + 'T23:59:59Z')
    }

    if (search) {
      where.OR = [
        { entity: { contains: search, mode: 'insensitive' } },
        { action: { contains: search, mode: 'insensitive' } },
        { entityId: { contains: search, mode: 'insensitive' } },
        { user: { username: { contains: search, mode: 'insensitive' } } },
        { user: { fullName: { contains: search, mode: 'insensitive' } } },
      ]
    }

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        take: limit,
        skip: (page - 1) * limit,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { username: true, fullName: true } } },
      }),
    ])

    return successResponse({
      logs: logs.map(l => ({
        id: l.id,
        action: l.action,
        entity: l.entity,
        entityId: l.entityId,
        changes: l.changes,
        ipAddress: l.ipAddress,
        username: l.user.username,
        fullName: l.user.fullName,
        userId: l.userId,
        createdAt: l.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (err) {
    console.error('GET /api/admin/audit-logs error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
