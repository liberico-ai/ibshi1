import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { ensureDailyReportTasks } from '@/lib/workflow-engine'

// POST /api/tasks/ensure-daily-report — Ensure P5.1 (+ P5.1A) daily-report tasks exist for a project.
// Called when PM/QLSX phát hành LSX so material-less stages still open the daily report,
// without waiting for Kho to complete a P4.5. Idempotent.
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload?.userId) return unauthorizedResponse()

    const { projectId } = await req.json()
    if (!projectId) return errorResponse('projectId là bắt buộc', 400)

    await ensureDailyReportTasks(projectId)
    return successResponse({ ok: true }, 'Đã đảm bảo task báo cáo ngày tồn tại')
  } catch (err) {
    console.error('POST /api/tasks/ensure-daily-report error:', err)
    return errorResponse('Lỗi hệ thống khi tạo task báo cáo ngày', 500)
  }
}
