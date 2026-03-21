import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { getTaskById, assignTask } from '@/lib/task-engine'
import { completeTask } from '@/lib/workflow-engine'
import prisma from '@/lib/db'

// GET /api/tasks/[id]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const { id } = await params
    const task = await getTaskById(id)
    if (!task) return errorResponse('Task không tồn tại', 404)

    // Fetch sibling context based on step
    let siblingFiles: Record<string, string> | null = null
    let rejectionInfo: { reason: string; rejectedBy: string; rejectedAt: string } | null = null

    // Helper: resolve attached files from resultData or legacy description metadata
    function resolveFiles(
      resultData: Record<string, unknown> | null,
      description: string | null
    ): Record<string, string> | null {
      // Check new format: resultData.attachedFiles
      if (resultData?.attachedFiles) {
        return resultData.attachedFiles as Record<string, string>
      }
      // Fallback: legacy <!--FILES:{...}--> in description
      if (description) {
        const match = description.match(/<!--FILES:(.*?)-->/)
        if (match) {
          try { return JSON.parse(match[1]) } catch { /* ignore */ }
        }
      }
      return null
    }

    if (task.stepCode === 'P1.1B') {
      // For P1.1B: fetch P1.1's attached files
      const p1Task = await prisma.workflowTask.findFirst({
        where: { projectId: task.projectId, stepCode: 'P1.1' },
        select: { resultData: true },
      })
      siblingFiles = resolveFiles(
        p1Task?.resultData as Record<string, unknown> | null,
        task.project?.description || null
      )
    }

    if (task.stepCode === 'P1.1') {
      // For P1.1: load its own attached files (from previous completion)
      const rd = task.resultData as Record<string, unknown> | null
      siblingFiles = resolveFiles(rd, task.project?.description || null)

      // Fetch P1.1B rejection info
      const p1bTask = await prisma.workflowTask.findFirst({
        where: { projectId: task.projectId, stepCode: 'P1.1B', status: 'REJECTED' },
        select: { notes: true, completedBy: true, completedAt: true },
        orderBy: { completedAt: 'desc' },
      })
      if (p1bTask?.notes) {
        const reason = p1bTask.notes.replace(/^REJECTED:\s*/, '')
        let rejectedByName = 'BGĐ'
        if (p1bTask.completedBy) {
          const user = await prisma.user.findUnique({
            where: { id: p1bTask.completedBy },
            select: { fullName: true },
          })
          if (user) rejectedByName = user.fullName
        }
        rejectionInfo = {
          reason,
          rejectedBy: rejectedByName,
          rejectedAt: p1bTask.completedAt?.toISOString() || '',
        }
      }
    }

    // For P1.3: fetch both P1.2A (plan) and P1.2 (estimate) data
    let previousStepData: Record<string, unknown> | null = null
    if (task.stepCode === 'P1.3') {
      const [p12aTask, p12Task] = await Promise.all([
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P1.2A' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P1.2' },
          select: { resultData: true, status: true },
        }),
      ])
      previousStepData = {
        plan: p12aTask?.resultData || null,
        estimate: p12Task?.resultData || null,
      }
    }

    // For P2.3: fetch P2.2 (BOM) data + P1.2 (estimate) for comparison
    if (task.stepCode === 'P2.3') {
      const [p22Task, p12Task] = await Promise.all([
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.2' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P1.2' },
          select: { resultData: true, status: true },
        }),
      ])
      previousStepData = {
        bom: p22Task?.resultData || null,
        estimate: p12Task?.resultData || null,
      }
    }

    // For P2.4: fetch BOM data from P2.1 (VT chính), P2.2 (VT hàn/sơn), P2.3 (VT phụ) + P1.2 estimate
    if (task.stepCode === 'P2.4') {
      const [p21Task, p22Task, p23Task, p12Task] = await Promise.all([
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.1' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.2' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.3' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P1.2' },
          select: { resultData: true, status: true },
        }),
      ])
      previousStepData = {
        bomMain: p21Task?.resultData || null,       // VT chính from Thiết kế
        bomWeldPaint: p22Task?.resultData || null,   // VT hàn/sơn from PM
        bomSupply: p23Task?.resultData || null,      // VT phụ from Kho
        estimate: p12Task?.resultData || null,       // Dự toán from KTKH
      }
    }

    // For P2.5: fetch P2.4 (KH SX + dự toán điều chỉnh) + P1.2 estimate + BOM from P2.1/P2.2/P2.3
    if (task.stepCode === 'P2.5') {
      const [p24Task, p21Task, p22Task, p23Task, p12Task] = await Promise.all([
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.4' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.1' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.2' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.3' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P1.2' },
          select: { resultData: true, status: true },
        }),
      ])
      previousStepData = {
        plan: p24Task?.resultData || null,           // KH SX + dự toán điều chỉnh from KTKH
        estimate: p12Task?.resultData || null,       // Dự toán gốc from P1.2
        bomMain: p21Task?.resultData || null,
        bomWeldPaint: p22Task?.resultData || null,
        bomSupply: p23Task?.resultData || null,
      }
    }

    return successResponse({ task, siblingFiles, rejectionInfo, previousStepData })
  } catch (err) {
    console.error('GET /api/tasks/[id] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// PUT /api/tasks/[id] — Complete or assign task
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const { id } = await params
    const body = await req.json()
    const { action } = body

    if (action === 'save') {
      // Save resultData without completing — used for partial approval state
      await prisma.workflowTask.update({
        where: { id },
        data: { resultData: body.resultData ? JSON.parse(JSON.stringify(body.resultData)) : undefined },
      })
      return successResponse({}, 'Đã lưu dữ liệu')
    }

    if (action === 'complete') {
      const result = await completeTask(id, payload.userId, body.resultData, body.notes)
      return successResponse({ nextSteps: result.nextSteps }, 'Task hoàn thành')
    }

    if (action === 'assign') {
      if (payload.userLevel > 1) {
        return errorResponse('Chỉ L1 (trưởng phòng) mới có quyền phân công', 403)
      }
      const updated = await assignTask(id, body.assignToUserId)
      return successResponse({ task: updated }, 'Đã phân công task')
    }

    return errorResponse('Action không hợp lệ. Sử dụng: complete, assign')
  } catch (err) {
    console.error('PUT /api/tasks/[id] error:', err)
    return errorResponse((err as Error).message || 'Lỗi hệ thống', 500)
  }
}
