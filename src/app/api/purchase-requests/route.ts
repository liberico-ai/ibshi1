'use server'

import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { validateQuery, validateBody } from '@/lib/api-helpers'
import { prListQuerySchema, createPurchaseRequestSchema } from '@/lib/schemas'
import { fetchPoCoverageMap, computePrCoverage, type PrCoverageSummary } from '@/lib/pr-coverage'

// GET /api/purchase-requests — List purchase requests
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const qResult = validateQuery(req.url, prListQuerySchema)
    if (!qResult.success) return qResult.response
    const { page, status, originType, originId, projectId, withCoverage } = qResult.data
    const limit = 20

    const where: Record<string, unknown> = {}
    if (status) where.status = status
    // Lọc theo nguồn phát sinh (ECO/NCR) — Đợt 2D truy vết
    if (originType) where.originType = originType
    if (originId) where.originId = originId
    if (projectId) where.projectId = projectId

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

    // [P2-đợt2 B1] ?withCoverage=1 → tính độ phủ PO cho các PR APPROVED trong trang
    // (query gộp theo projectIds + materialIds — tránh N+1). Không có flag → shape cũ giữ nguyên.
    let coverageByPrId: Map<string, PrCoverageSummary> | null = null
    if (withCoverage === '1') {
      coverageByPrId = new Map()
      const approved = prs.filter(pr => pr.status === 'APPROVED')
      if (approved.length > 0) {
        const projectIds = [...new Set(approved.map(pr => pr.projectId))]
        // Bỏ dòng chưa khớp mã vật tư (materialId null) — không có khoá để đối chiếu PO
        const materialIds = [...new Set(approved.flatMap(pr => pr.items.map(i => i.materialId)))]
          .filter((id): id is string => id !== null)
        const poMap = await fetchPoCoverageMap(projectIds, materialIds)
        for (const pr of approved) {
          coverageByPrId.set(pr.id, computePrCoverage(pr.projectId, pr.items, poMap).summary)
        }
      }
    }

    // Bước 5 — nối task nguồn + PO liên quan (cùng sourceTaskId). Batch, tránh N+1.
    const sourceTaskIds = [...new Set(prs.map(pr => pr.sourceTaskId).filter((x): x is string => !!x))]
    const taskById = new Map<string, { id: string; title: string }>()
    const poByTaskId = new Map<string, { id: string; poCode: string; status: string }>()
    if (sourceTaskIds.length > 0) {
      const [srcTasks, relatedPos] = await Promise.all([
        prisma.task.findMany({ where: { id: { in: sourceTaskIds } }, select: { id: true, title: true } }),
        prisma.purchaseOrder.findMany({
          where: { sourceTaskId: { in: sourceTaskIds } },
          select: { id: true, poCode: true, status: true, sourceTaskId: true },
        }),
      ])
      for (const t of srcTasks) taskById.set(t.id, { id: t.id, title: t.title })
      for (const po of relatedPos) if (po.sourceTaskId) poByTaskId.set(po.sourceTaskId, { id: po.id, poCode: po.poCode, status: po.status })
    }

    return successResponse({
      purchaseRequests: prs.map((pr: Record<string, unknown> & { items: Array<Record<string, unknown>>; sourceTaskId?: string | null }) => ({
        ...pr,
        itemCount: pr.items.length,
        totalItems: pr.items.reduce((sum: number, i: Record<string, unknown>) => sum + Number(i.quantity || 0), 0),
        // Task nguồn + PO liên quan (null nếu PR tạo tay/không từ task)
        sourceTask: pr.sourceTaskId ? (taskById.get(pr.sourceTaskId) ?? null) : null,
        relatedPo: pr.sourceTaskId ? (poByTaskId.get(pr.sourceTaskId) ?? null) : null,
        // coverage chỉ xuất hiện khi withCoverage=1; PR không APPROVED → null
        ...(coverageByPrId ? { coverage: coverageByPrId.get(pr.id as string) ?? null } : {}),
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

    // R02 (PM), R03 (KTKH), R05 (Kho), R08/R08a (Kế toán), R01 (BGĐ) can create PR
    if (!['R01', 'R02', 'R03', 'R05', 'R08', 'R08a'].includes(payload.roleCode)) {
      return errorResponse('Bạn không có quyền tạo yêu cầu mua hàng', 403)
    }

    const result = await validateBody(req, createPurchaseRequestSchema)
    if (!result.success) return result.response
    const { projectId, urgency, notes, items, originType, originId, originLabel } = result.data

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
        // Nguồn phát sinh (Đợt 2D): PR từ ECO (bomVersionId) / NCR (ncr.id)
        originType: originType || null,
        originId: originId || null,
        originLabel: originLabel || null,
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
