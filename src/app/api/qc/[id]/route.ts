'use server'

import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { RBAC } from '@/lib/rbac-rules'
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

    if (!RBAC.QC_ACTION.includes(payload.roleCode)) {
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

    return successResponse({ inspection }, `Biên bản đã ${status === 'PASSED' ? 'đạt' : status === 'FAILED' ? 'không đạt' : 'đạt có điều kiện'}`)
  } catch (err) {
    console.error('PUT /api/qc/:id error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
