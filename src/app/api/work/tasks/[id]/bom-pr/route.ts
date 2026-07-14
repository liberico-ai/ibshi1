import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { canEditForm } from '@/lib/constants'
import { enrichBomPrItems } from '@/lib/bompr-enrich'
import { materializePrSafe } from '@/lib/pr-materialize'

export const dynamic = 'force-dynamic'

const REQUIRED_DATE_ROLES = ['R01', 'R02', 'R02a']

// POST /api/work/tasks/[id]/bom-pr  { data: string, action?: 'save'|'enrich'|'set-required-dates' }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params

    const body = await req.json().catch(() => ({})) as {
      data?: string
      action?: string
      requiredDates?: Record<string, string>
    }
    const action = body.action || 'save'

    const task = await prisma.task.findUnique({
      where: { id },
      select: {
        id: true, createdBy: true,
        project: { select: { projectCode: true } },
        assignees: { select: { userId: true, role: true } },
        resultData: true,
      },
    })
    if (!task) return errorResponse('Không tìm thấy công việc', 404)

    const isParticipant = task.createdBy === payload.userId
      || task.assignees.some(a => a.userId === payload.userId || a.role === payload.roleCode)

    // PM sets requiredDate per line — carve-out: no PR edit role needed, no participant check
    if (action === 'set-required-dates') {
      if (!REQUIRED_DATE_ROLES.includes(payload.roleCode)) {
        return errorResponse('Chỉ PM / BGĐ được đặt ngày cần hàng', 403)
      }
      const rd = task.resultData as Record<string, unknown> | null
      const existing = rd?.bomPrItems || rd?.bomPr || ''
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let items: any[] = []
      try { items = typeof existing === 'string' ? JSON.parse(existing) : (Array.isArray(existing) ? existing : []) } catch { items = [] }
      if (items.length === 0) return errorResponse('Chưa có dữ liệu PR', 400)

      const dates = body.requiredDates || {}
      const updated = items.map((it: Record<string, unknown>, i: number) => {
        const val = dates[String(i)]
        if (val !== undefined) return { ...it, requiredDate: val || undefined }
        return it
      })
      const patch = JSON.stringify({ bomPrItems: JSON.stringify(updated) })
      await prisma.$executeRaw`
        UPDATE "tasks"
        SET "result_data" = COALESCE("result_data", '{}'::jsonb) || ${patch}::jsonb,
            "updated_at" = now()
        WHERE "id" = ${id}`
      await materializePrSafe(id, payload.userId)
      return successResponse({ updated: true })
    }

    // Enrich: re-calculate stock breakdown — any authenticated user can trigger
    if (action === 'enrich') {
      const rd = task.resultData as Record<string, unknown> | null
      const existing = rd?.bomPrItems || rd?.bomPr || ''
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let items: any[] = []
      try { items = typeof existing === 'string' ? JSON.parse(existing) : (Array.isArray(existing) ? existing : []) } catch { items = [] }
      if (items.length === 0) return errorResponse('Chưa có dữ liệu PR', 400)

      const enriched = await enrichBomPrItems(items, task.project?.projectCode)
      const patch = JSON.stringify({ bomPrItems: JSON.stringify(enriched) })
      await prisma.$executeRaw`
        UPDATE "tasks"
        SET "result_data" = COALESCE("result_data", '{}'::jsonb) || ${patch}::jsonb,
            "updated_at" = now()
        WHERE "id" = ${id}`
      await materializePrSafe(id, payload.userId)
      return successResponse({ enriched: true, count: enriched.length })
    }

    // Default: save bomPr data + auto-enrich — requires participant + PR edit role
    if (!isParticipant) return errorResponse('Bạn không có quyền sửa công việc này', 403)
    if (!canEditForm('PR', payload.roleCode)) {
      return errorResponse('Bạn không có quyền sửa biểu mẫu PR', 403)
    }

    const rawData = body.data || ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let items: any[] = []
    try { items = rawData ? JSON.parse(rawData) : [] } catch { items = [] }

    let finalData = rawData
    if (items.length > 0) {
      const enriched = await enrichBomPrItems(items, task.project?.projectCode)
      finalData = JSON.stringify(enriched)
    }

    const patch = JSON.stringify({ bomPrItems: finalData })
    await prisma.$executeRaw`
      UPDATE "tasks"
      SET "result_data" = COALESCE("result_data", '{}'::jsonb) || ${patch}::jsonb,
          "updated_at" = now()
      WHERE "id" = ${id}`
    // Sinh/cập nhật PR (sau FF_PR_MATERIALIZE, mặc định TẮT). Không bao giờ throw.
    await materializePrSafe(id, payload.userId)
    return successResponse({})
  } catch (err) {
    console.error('POST /api/work/tasks/[id]/bom-pr error:', err)
    return errorResponse('Lỗi lưu PR', 500)
  }
}
