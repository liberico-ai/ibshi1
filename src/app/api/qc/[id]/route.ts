'use server'

import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { can } from '@/lib/permissions/can'
import { validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'

// GET /api/qc/:id — Inspection detail + checklist items
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const pResult = validateParams(await params, idParamSchema)
    if (!pResult.success) return pResult.response
    const { id } = pResult.data

    const inspection = await prisma.inspection.findUnique({
      where: { id },
      include: { checklistItems: true },
    })

    if (!inspection) return errorResponse('Không tìm thấy biên bản QC', 404)

    return successResponse({ inspection })
  } catch (err) {
    console.error('GET /api/qc/:id error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// PUT /api/qc/:id — Record inspection result
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    if (!(await can(payload, 'action.qc'))) {
      return errorResponse('Không có quyền thao tác đánh giá QC', 403)
    }

    const pResult2 = validateParams(await params, idParamSchema)
    if (!pResult2.success) return pResult2.response
    const { id } = pResult2.data
    const body = await req.json()
    const { status, remarks, checklistResults } = body

    if (!status || !['PASSED', 'FAILED', 'CONDITIONAL'].includes(status)) {
      return errorResponse('Status phải là: PASSED, FAILED, CONDITIONAL')
    }

    // Update checklist items if provided
    if (checklistResults && Array.isArray(checklistResults)) {
      for (const item of checklistResults) {
        await prisma.inspectionItem.update({
          where: { id: item.id },
          data: {
            result: item.result,
            measurement: item.measurement || null,
            notes: item.notes || null,
          },
        })
      }
    }

    const inspection = await prisma.inspection.update({
      where: { id },
      data: {
        status,
        remarks: remarks || null,
        inspectedAt: new Date(),
        inspectorId: payload.userId,
      },
      include: { checklistItems: true },
    })

    // Nghiệm thu vật tư KHÔNG ĐẠT → trả về TM (R07/R07a) để tìm nhà cung cấp khác.
    if (status === 'FAILED' && inspection.type === 'material_incoming') {
      try {
        const poIds = ((inspection.resultData as { poIds?: string[] } | null)?.poIds) || []
        let poCodes = ''
        if (poIds.length > 0) {
          const pos = await prisma.purchaseOrder.findMany({ where: { id: { in: poIds } }, select: { poCode: true } })
          poCodes = pos.map(p => p.poCode).join(', ')
        }
        const tmUsers = await prisma.user.findMany({
          where: { roleCode: { in: ['R07', 'R07a'] }, isActive: true },
          select: { id: true },
        })
        if (tmUsers.length > 0) {
          await prisma.notification.createMany({
            data: tmUsers.map((u) => ({
              userId: u.id,
              title: 'Hàng không đạt QC — cần tìm NCC khác',
              message: `Biên bản ${inspection.inspectionCode} KHÔNG ĐẠT${poCodes ? ` (PO: ${poCodes})` : ''}. Vui lòng tìm nhà cung cấp khác.`,
              type: 'qc_failed',
              linkUrl: '/dashboard/warehouse/purchase-orders',
            })),
          })
        }
      } catch (e) {
        console.error('[QC] notify TM (failed) error:', e)
      }
    }

    // Nghiệm thu vật tư ĐẠT → sinh task "THÔNG BÁO" P4.4 (Kho nghiệm thu KL + nhập kho) cho Kho —
    // 1 lần / PO. Đây là con trỏ sang tab Kho (Nhập hàng GRN); mở lần đầu tự đánh dấu đã đọc.
    if (status === 'PASSED' && inspection.type === 'material_incoming') {
      try {
        const poIds = ((inspection.resultData as { poIds?: string[] } | null)?.poIds) || []
        if (poIds.length > 0) {
          const pos = await prisma.purchaseOrder.findMany({ where: { id: { in: poIds } }, select: { id: true, poCode: true, projectId: true } })
          for (const po of pos) {
            const existed = await prisma.task.findFirst({
              where: { taskType: 'P4.4', resultData: { path: ['poId'], equals: po.id } },
              select: { id: true },
            })
            if (existed) continue
            const t = await prisma.task.create({
              data: {
                projectId: po.projectId || null,
                level: 2,
                taskType: 'P4.4',
                title: `Kho nghiệm thu khối lượng & nhập kho — ${po.poCode}`,
                description: `Hàng của ${po.poCode} đã QC Đạt. Mở tab Kho để nghiệm thu khối lượng và nhập kho.`,
                priority: 'HIGH',
                createdBy: payload.userId,
                assignedAt: new Date(),
                status: 'OPEN',
                resultData: { poId: po.id, poCode: po.poCode, notify: true },
              },
            })
            await prisma.taskAssignee.createMany({
              data: [
                { taskId: t.id, role: 'R05', userId: null, isPrimary: true },
                { taskId: t.id, role: 'R05a', userId: null, isPrimary: false },
              ],
            })
            await prisma.taskHistory.create({ data: { taskId: t.id, action: 'CREATED', byUserId: payload.userId } })
          }
        }
      } catch (e) {
        console.error('[QC] spawn P4.4 notify task error:', e)
      }
    }

    return successResponse({ inspection }, `Biên bản đã ${status === 'PASSED' ? 'đạt' : status === 'FAILED' ? 'không đạt' : 'đạt có điều kiện'}`)
  } catch (err) {
    console.error('PUT /api/qc/:id error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
