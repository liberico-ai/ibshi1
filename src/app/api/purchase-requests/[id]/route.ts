'use server'

import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { RBAC } from '@/lib/rbac-rules'
import { validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'

// PUT /api/purchase-requests/[id] — Approve/Reject/Update PR
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const pResult = validateParams(await params, idParamSchema)
    if (!pResult.success) return pResult.response
    const { id } = pResult.data
    const body = await req.json()
    const { action } = body // 'approve' | 'reject' | 'convert'

    const pr = await prisma.purchaseRequest.findUnique({
      where: { id },
      include: { items: { include: { material: true } } },
    })
    if (!pr) return errorResponse('Không tìm thấy yêu cầu mua hàng', 404)

    if (action === 'approve') {
      if (!RBAC.PR_APPROVAL.includes(payload.roleCode)) {
        return errorResponse('Chỉ Ban Giám đốc hoặc PM mới được duyệt PR', 403)
      }
      if (pr.status !== 'SUBMITTED') {
        return errorResponse('PR phải ở trạng thái "Đã gửi" để duyệt')
      }

      const updated = await prisma.purchaseRequest.update({
        where: { id },
        data: { status: 'APPROVED', approvedBy: payload.userId, approvedAt: new Date() },
      })
      return successResponse({ purchaseRequest: updated }, 'Đã phê duyệt yêu cầu mua hàng')
    }

    if (action === 'reject') {
      if (!RBAC.PR_APPROVAL.includes(payload.roleCode)) {
        return errorResponse('Chỉ Ban Giám đốc hoặc PM mới được từ chối PR', 403)
      }
      const updated = await prisma.purchaseRequest.update({
        where: { id },
        data: { status: 'REJECTED', approvedBy: payload.userId, approvedAt: new Date(), notes: body.reason || pr.notes },
      })
      return successResponse({ purchaseRequest: updated }, 'Đã từ chối yêu cầu mua hàng')
    }

    if (action === 'convert') {
      // Convert approved PR → PO
      if (!['R01', 'R05', 'R07'].includes(payload.roleCode)) {
        return errorResponse('Không có quyền chuyển PR thành PO', 403)
      }
      if (pr.status !== 'APPROVED') {
        return errorResponse('PR phải được duyệt trước khi chuyển thành PO')
      }
      if (!body.vendorId) {
        return errorResponse('Cần chọn nhà cung cấp')
      }

      // Generate PO code
      const year = new Date().getFullYear().toString().slice(-2)
      const lastPo = await prisma.purchaseOrder.findFirst({
        where: { poCode: { startsWith: `PO-${year}-` } },
        orderBy: { poCode: 'desc' },
      })
      const seq = lastPo ? parseInt(lastPo.poCode.split('-')[2]) + 1 : 1
      const poCode = `PO-${year}-${String(seq).padStart(3, '0')}`

      // Create PO with items from PR
      const totalValue = pr.items.reduce((sum, item) => {
        const price = Number(item.material.unitPrice || 0)
        return sum + price * Number(item.quantity)
      }, 0)

      const po = await prisma.purchaseOrder.create({
        data: {
          poCode,
          vendorId: body.vendorId,
          status: 'DRAFT',
          totalValue,
          orderDate: new Date(),
          deliveryDate: body.deliveryDate ? new Date(body.deliveryDate) : null,
          paymentTerms: body.paymentTerms || null,
          createdBy: payload.userId,
          notes: `Từ ${pr.prCode}`,
          items: {
            create: pr.items.map((item) => ({
              materialId: item.materialId,
              quantity: item.quantity,
              unitPrice: item.material.unitPrice || 0,
            })),
          },
        },
        include: {
          vendor: { select: { name: true, vendorCode: true } },
          items: { include: { material: { select: { materialCode: true, name: true, unit: true } } } },
        },
      })

      // Mark PR as converted
      await prisma.purchaseRequest.update({
        where: { id },
        data: { status: 'CONVERTED' },
      })

      return successResponse({ purchaseOrder: po }, `Đã tạo đơn hàng ${poCode} từ ${pr.prCode}`, 201)
    }

    return errorResponse('Action không hợp lệ. Sử dụng: approve, reject, convert')
  } catch (err) {
    console.error('PUT /api/purchase-requests/[id] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// GET /api/purchase-requests/[id] — PR detail
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const pResult2 = validateParams(await params, idParamSchema)
    if (!pResult2.success) return pResult2.response
    const { id } = pResult2.data
    const pr = await prisma.purchaseRequest.findUnique({
      where: { id },
      include: {
        project: { select: { projectCode: true, projectName: true } },
        items: { include: { material: { select: { materialCode: true, name: true, unit: true, currentStock: true, minStock: true } } } },
      },
    })
    if (!pr) return errorResponse('Không tìm thấy', 404)

    return successResponse({ purchaseRequest: pr })
  } catch (err) {
    console.error('GET /api/purchase-requests/[id] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
