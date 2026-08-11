import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { completeStepTaskFromSidebar } from '@/lib/work-engine'

export const dynamic = 'force-dynamic'

// Cầu nối chung "tab sidebar ↔ task quy trình 32 bước" (Cách A).
// Dùng cho MỌI bước làm ở sidebar: tìm task đang mở của (projectId, stepCode) rồi
// GET → lấy taskId + resultData (để render editor); POST action:'complete' → đóng
// task + sinh bước kế (completeStepTaskFromSidebar). Lưu nháp resultData vẫn dùng
// endpoint có sẵn POST /api/work/tasks/[taskId]/result-data (key theo ALLOWED_KEYS).

const OPEN = ['OPEN', 'IN_PROGRESS', 'RETURNED']

const STEP_TASK_SELECT = {
  id: true, status: true, resultData: true, createdBy: true,
  assignees: { select: { userId: true, role: true } },
  project: { select: { projectCode: true, projectName: true, clientName: true, contractValue: true } },
} as const

// Ưu tiên task đang mở (để làm/hoàn thành). Nếu bước đã DONE, trả task DONE gần nhất
// để card sidebar vẫn cho "Bổ sung / Chỉnh sửa" (amend) — ngang bản gốc trong Hộp việc.
// ƯU TIÊN bản do chuỗi sinh (templateStepId ≠ null) để tránh vớ nhầm task trùng nhãn; nếu dự án
// CHỈ có task cùng taskType chưa gắn link (tạo tay/import) → VẪN trả về để VÙNG LÀM VIỆC hiện ra.
async function findActiveStepTask(projectId: string, stepCode: string) {
  const pick = async (statuses: readonly string[]) => {
    const withTpl = await prisma.task.findFirst({
      where: { projectId, taskType: stepCode, templateStepId: { not: null }, status: { in: [...statuses] } },
      orderBy: { createdAt: 'desc' }, select: STEP_TASK_SELECT,
    })
    if (withTpl) return withTpl
    return prisma.task.findFirst({
      where: { projectId, taskType: stepCode, status: { in: [...statuses] } },
      orderBy: { createdAt: 'desc' }, select: STEP_TASK_SELECT,
    })
  }
  return (await pick(OPEN)) || (await pick(['DONE']))
}

// GET /api/work/step-task?projectId=&stepCode=
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const url = new URL(req.url)
    const projectId = url.searchParams.get('projectId') || ''
    const stepCode = url.searchParams.get('stepCode') || ''
    if (!projectId || !stepCode) return errorResponse('Thiếu projectId hoặc stepCode', 400)

    const task = await findActiveStepTask(projectId, stepCode)
    if (!task) return successResponse({ task: null })

    const canEdit = task.createdBy === payload.userId
      || task.assignees.some((a) => a.userId === payload.userId || a.role === payload.roleCode)
      || ['R01', 'R10'].includes(payload.roleCode)
    const project = task.project
      ? { projectCode: task.project.projectCode, projectName: task.project.projectName, clientName: task.project.clientName, contractValue: task.project.contractValue ? Number(task.project.contractValue) : 0 }
      : null
    return successResponse({ task: { id: task.id, status: task.status, resultData: task.resultData || {}, canEdit, project } })
  } catch (err) {
    console.error('GET /api/work/step-task error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/work/step-task  { projectId, stepCode, action:'complete', resultData? }
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const body = await req.json().catch(() => ({})) as { projectId?: string; stepCode?: string; action?: string; resultData?: Record<string, unknown> }
    const { projectId, stepCode } = body
    if (!projectId || !stepCode) return errorResponse('Thiếu projectId hoặc stepCode', 400)
    if (body.action !== 'complete') return errorResponse('Action không hợp lệ', 400)

    const task = await findActiveStepTask(projectId, stepCode)
    if (!task) return errorResponse('Không có bước đang mở cho dự án này', 422)
    if (!OPEN.includes(task.status)) return errorResponse('Bước này đã hoàn thành', 422)

    const isParticipant = task.createdBy === payload.userId
      || task.assignees.some((a) => a.userId === payload.userId || a.role === payload.roleCode)
      || ['R01', 'R10'].includes(payload.roleCode)
    if (!isParticipant) return errorResponse('Bạn không phải người phụ trách bước này', 403)

    const r = await completeStepTaskFromSidebar(projectId, stepCode, payload.userId, body.resultData)
    if (!r.ok) return errorResponse(r.reason && r.reason !== 'no_task' ? r.reason : 'Không hoàn thành được bước này', 422)
    return successResponse({ taskId: r.taskId }, 'Đã hoàn thành bước — quy trình chuyển tiếp')
  } catch (err) {
    console.error('POST /api/work/step-task error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
