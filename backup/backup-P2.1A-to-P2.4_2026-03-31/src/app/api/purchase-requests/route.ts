'use server'

import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/purchase-requests — List purchase requests
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = 20

    const where: Record<string, unknown> = {}
    if (status) where.status = status

    const [total, prs] = await Promise.all([
      prisma.purchaseRequest.count({ where }),
      prisma.purchaseRequest.findMany({
        where,
        include: {
          project: { select: { projectCode: true, projectName: true } },
          items: {
            include: { material: { select: { materialCode: true, name: true, unit: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ])

    return successResponse({
      purchaseRequests: prs.map((pr: Record<string, unknown> & { items: Array<Record<string, unknown>> }) => ({
        ...pr,
        itemCount: pr.items.length,
        totalItems: pr.items.reduce((sum: number, i: Record<string, unknown>) => sum + Number(i.quantity || 0), 0),
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('GET /api/purchase-requests error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/purchase-requests — Create new PR
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    // R02 (PM), R03 (KTKH), R05 (Kho), R01 (BGĐ) can create PR
    if (!['R01', 'R02', 'R03', 'R05'].includes(payload.roleCode)) {
      return errorResponse('Bạn không có quyền tạo yêu cầu mua hàng', 403)
    }

    const body = await req.json()
    const { projectId, urgency, notes, items } = body

    if (!projectId || !items || items.length === 0) {
      return errorResponse('Cần chọn dự án và ít nhất 1 vật tư')
    }

    // Generate PR code: PR-YY-NNN
    const year = new Date().getFullYear().toString().slice(-2)
    const lastPr = await prisma.purchaseRequest.findFirst({
      where: { prCode: { startsWith: `PR-${year}-` } },
      orderBy: { prCode: 'desc' },
    })
    const seq = lastPr ? parseInt(lastPr.prCode.split('-')[2]) + 1 : 1
    const prCode = `PR-${year}-${String(seq).padStart(3, '0')}`

    const pr = await prisma.purchaseRequest.create({
      data: {
        prCode,
        projectId,
        requestedBy: payload.userId,
        urgency: urgency || 'NORMAL',
        notes,
        status: 'SUBMITTED',
        items: {
          create: items.map((item: { materialId: string; quantity: number; requiredDate?: string; notes?: string }) => ({
            materialId: item.materialId,
            quantity: item.quantity,
            requiredDate: item.requiredDate ? new Date(item.requiredDate) : null,
            notes: item.notes,
          })),
        },
      },
      include: {
        project: { select: { projectCode: true, projectName: true } },
        items: { include: { material: { select: { materialCode: true, name: true, unit: true } } } },
      },
    })

    return successResponse({ purchaseRequest: pr }, `Yêu cầu mua hàng ${prCode} đã được tạo`, 201)
  } catch (err) {
    console.error('POST /api/purchase-requests error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
