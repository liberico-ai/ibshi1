'use server'

import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/qc — List inspections
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')
    const type = searchParams.get('type')
    const status = searchParams.get('status')
    const search = searchParams.get('search') || ''
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')))

    const where: Record<string, unknown> = {}
    if (projectId) where.projectId = projectId
    if (type) where.type = type
    if (status) where.status = status
    if (search) {
      where.OR = [
        { inspectionCode: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [total, inspections] = await Promise.all([
      prisma.inspection.count({ where }),
      prisma.inspection.findMany({
        where,
        include: {
          checklistItems: {
            select: { id: true, checkItem: true, result: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ])

    const result = inspections.map((i: Record<string, unknown> & { checklistItems: Array<Record<string, unknown>> }) => ({
      id: i.id,
      projectId: i.projectId,
      inspectionCode: i.inspectionCode,
      type: i.type,
      stepCode: i.stepCode,
      status: i.status,
      inspectorId: i.inspectorId,
      inspectedAt: i.inspectedAt,
      remarks: i.remarks,
      totalItems: i.checklistItems.length,
      passedItems: i.checklistItems.filter((ci: Record<string, unknown>) => ci.result === 'PASS').length,
      failedItems: i.checklistItems.filter((ci: Record<string, unknown>) => ci.result === 'FAIL').length,
      createdAt: i.createdAt,
    }))

    return successResponse({
      inspections: result,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('GET /api/qc error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/qc — Create inspection
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    if (!['R01', 'R09'].includes(payload.roleCode)) {
      return errorResponse('Không có quyền tạo biên bản QC', 403)
    }

    const body = await req.json()
    const { inspectionCode, projectId, type, stepCode, checklistItems } = body

    if (!inspectionCode || !projectId || !type || !stepCode) {
      return errorResponse('Thiếu: mã biên bản, dự án, loại, bước workflow')
    }

    const existing = await prisma.inspection.findUnique({ where: { inspectionCode } })
    if (existing) return errorResponse(`Mã biên bản ${inspectionCode} đã tồn tại`)

    const inspection = await prisma.inspection.create({
      data: {
        inspectionCode,
        projectId,
        type,
        stepCode,
        inspectorId: payload.userId,
        checklistItems: {
          create: (checklistItems || []).map((item: { checkItem: string; standard?: string }) => ({
            checkItem: item.checkItem,
            standard: item.standard || null,
          })),
        },
      },
      include: { checklistItems: true },
    })

    return successResponse({ inspection }, 'Biên bản QC đã tạo', 201)
  } catch (err) {
    console.error('POST /api/qc error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
