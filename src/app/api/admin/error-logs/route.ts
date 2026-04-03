import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse } from '@/lib/auth'

const ADMIN_ROLES = ['R01', 'R10']

// GET /api/admin/error-logs — Paginated, filterable error logs
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!ADMIN_ROLES.includes(payload.roleCode)) return forbiddenResponse()

    const url = new URL(req.url)
    const page = parseInt(url.searchParams.get('page') || '1')
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '30'), 100)
    const level = url.searchParams.get('level') || ''
    const code = url.searchParams.get('code') || ''
    const source = url.searchParams.get('source') || ''
    const path = url.searchParams.get('path') || ''
    const resolved = url.searchParams.get('resolved')
    const search = url.searchParams.get('search') || ''
    const dateFrom = url.searchParams.get('from') || ''
    const dateTo = url.searchParams.get('to') || ''
    const userId = url.searchParams.get('userId') || ''

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {}

    if (level && level !== 'ALL') where.level = level
    if (code) where.code = code
    if (source) where.source = source
    if (path) where.path = { contains: path, mode: 'insensitive' }
    if (userId) where.userId = userId
    if (resolved === 'true') where.resolved = true
    else if (resolved === 'false') where.resolved = false

    if (dateFrom || dateTo) {
      where.createdAt = {}
      if (dateFrom) where.createdAt.gte = new Date(dateFrom)
      if (dateTo) where.createdAt.lte = new Date(dateTo + 'T23:59:59Z')
    }

    if (search) {
      where.OR = [
        { message: { contains: search, mode: 'insensitive' } },
        { path: { contains: search, mode: 'insensitive' } },
        { requestId: { contains: search, mode: 'insensitive' } },
      ]
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [total, logs, unresolvedCount, todayCount, topRoutes] = await Promise.all([
      prisma.errorLog.count({ where }),
      prisma.errorLog.findMany({
        where,
        take: limit,
        skip: (page - 1) * limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.errorLog.count({ where: { resolved: false } }),
      prisma.errorLog.count({ where: { createdAt: { gte: today } } }),
      prisma.errorLog.groupBy({
        by: ['path'],
        where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        _count: { path: true },
        orderBy: { _count: { path: 'desc' } },
        take: 5,
      }),
    ])

    return successResponse({
      logs: logs.map(l => ({
        id: l.id,
        level: l.level,
        message: l.message,
        stack: l.stack,
        code: l.code,
        requestId: l.requestId,
        method: l.method,
        path: l.path,
        statusCode: l.statusCode,
        duration: l.duration,
        userId: l.userId,
        userRole: l.userRole,
        ipAddress: l.ipAddress,
        userAgent: l.userAgent,
        requestBody: l.requestBody,
        metadata: l.metadata,
        source: l.source,
        resolved: l.resolved,
        createdAt: l.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      stats: {
        totalErrors: total,
        unresolvedCount,
        todayCount,
        topRoutes: topRoutes.map(r => ({ path: r.path || 'unknown', count: r._count.path })),
      },
    })
  } catch (err) {
    console.error('GET /api/admin/error-logs error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// PATCH /api/admin/error-logs — Mark resolved/unresolved
export async function PATCH(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!ADMIN_ROLES.includes(payload.roleCode)) return forbiddenResponse()

    const body = await req.json()
    const { ids, resolved } = body as { ids: string[]; resolved: boolean }

    if (!Array.isArray(ids) || ids.length === 0) {
      return errorResponse('Danh sách ID không hợp lệ', 400)
    }

    const result = await prisma.errorLog.updateMany({
      where: { id: { in: ids } },
      data: { resolved },
    })

    return successResponse({ updated: result.count })
  } catch (err) {
    console.error('PATCH /api/admin/error-logs error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/admin/error-logs — Client error report
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const body = await req.json()
    const { message, stack, path: errorPath, metadata } = body as {
      message: string
      stack?: string
      path?: string
      metadata?: Record<string, unknown>
    }

    if (!message) return errorResponse('Message is required', 400)

    const log = await prisma.errorLog.create({
      data: {
        level: 'ERROR',
        message: message.slice(0, 1000),
        stack: stack?.slice(0, 5000),
        code: 'UNKNOWN',
        path: errorPath,
        userId: payload.userId,
        userRole: payload.roleCode,
        source: 'client',
        metadata: metadata as object | undefined,
      },
    })

    return successResponse({ errorId: log.id })
  } catch (err) {
    console.error('POST /api/admin/error-logs error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
