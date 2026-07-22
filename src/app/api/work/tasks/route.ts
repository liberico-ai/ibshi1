import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { validateBody, validateData } from '@/lib/api-helpers'
import { createTaskSchema } from '@/lib/schemas'
import { createTask, dispatchWork } from '@/lib/work-engine'
import { isEnabled } from '@/lib/feature-flags'

export const dynamic = 'force-dynamic'

// Revise: KHÔNG cần assignees (openRevisionRound tự giao theo bước) → schema riêng.
const reviseSchema = z.object({
  projectId: z.string().min(1),
  reviseType: z.string().min(1),
  revisionId: z.string().optional(),
})

// POST /api/work/tasks — tạo việc động + giao cho nhiều phòng/người ([2]); hoặc mở vòng revise ([1], sau FF).
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    // ── Fork Revise Flow36 (sau FF). FF OFF → luồng tạo việc CŨ y hệt (validateBody + createTask). ──
    if (isEnabled('REVISE_FLOW')) {
      const raw = await req.json().catch(() => null)
      if (raw && typeof raw === 'object' && (raw as { reviseType?: string }).reviseType) {
        // Concern #2: dùng validateData → format lỗi 400 GIỐNG validateBody (nhất quán nhánh cũ).
        const p = validateData(raw, reviseSchema)
        if (!p.success) return p.response
        const r = await dispatchWork({ userId: payload.userId, revise: p.data })
        const round = r.kind === 'revise' ? r.round : undefined
        await logAudit(payload.userId, 'OPEN_REVISE_ROUND', 'Project', p.data.projectId, { reviseType: p.data.reviseType, round }, getClientIP(req))
        return successResponse({ revise: r }, `Đã mở vòng revise (round ${round})`, 201)
      }
      const p = validateData(raw, createTaskSchema)
      if (!p.success) return p.response
      const task = await createTask(p.data, payload.userId)
      await logAudit(payload.userId, 'CREATE', 'Task', task.id, { title: task.title }, getClientIP(req))
      return successResponse({ task }, 'Đã tạo & giao việc', 201)
    }

    // ── FF OFF — luồng cũ, KHÔNG đổi ──
    const result = await validateBody(req, createTaskSchema)
    if (!result.success) return result.response
    const task = await createTask(result.data, payload.userId)
    await logAudit(payload.userId, 'CREATE', 'Task', task.id, { title: task.title }, getClientIP(req))
    return successResponse({ task }, 'Đã tạo & giao việc', 201)
  } catch (err) {
    console.error('POST /api/work/tasks error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi hệ thống', 500)
  }
}
