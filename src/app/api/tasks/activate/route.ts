import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { WORKFLOW_RULES } from '@/lib/workflow-constants'
import prisma from '@/lib/db'
import { resolveRoleToUser } from '@/lib/work-engine'

const ACTIVATE_ROLES = ['R01', 'R02', 'R02a', 'R10']

// POST /api/tasks/activate — Create an independent multi-instance task (e.g., P4.5)
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!requireRoles(payload.roleCode, ACTIVATE_ROLES)) {
      return errorResponse('Không có quyền kích hoạt task', 403)
    }

    const body = await req.json()
    const { projectId, stepCode, materialInfo } = body

    if (!projectId || !stepCode) {
      return errorResponse('projectId and stepCode are required', 400)
    }

    // Use type assertion since WORKFLOW_RULES is typed as a Record<string, WorkflowStep>
    const rule = (WORKFLOW_RULES as Record<string, any>)[stepCode]
    if (!rule) {
      return errorResponse(`Invalid stepCode ${stepCode}`, 400)
    }

    // Determine dynamic stepName for P4.5 based on source
    let dynamicStepName = rule.name
    let dynamicStepNameEn = rule.nameEn
    if (stepCode === 'P4.5' && materialInfo?.sourceStep) {
      if (materialInfo.sourceStep === 'P3.3') {
        dynamicStepName = 'Kho cấp vật tư cho thầu phụ sản xuất'
        dynamicStepNameEn = 'Warehouse Issue Material for Subcontractor'
      } else if (materialInfo.sourceStep === 'P3.4') {
        dynamicStepName = 'Kho cấp vật tư cho nội bộ sản xuất'
        dynamicStepNameEn = 'Warehouse Issue Material for Internal Production'
      }
    }

    // CREATE a brand new task for this request, setting status directly to IN_PROGRESS
    const newTask = await prisma.task.create({
      data: {
        projectId,
        taskType: stepCode,
        title: dynamicStepName,
        description: dynamicStepNameEn,
        createdBy: payload.userId,
        status: 'IN_PROGRESS',
        deadline: rule.deadlineDays
          ? new Date(Date.now() + rule.deadlineDays * 24 * 60 * 60 * 1000)
          : null,
        startedAt: new Date(),
        resultData: materialInfo ? {
          sourceStep: materialInfo.sourceStep,
          materialIssueRequests: [
            {
              ...materialInfo,
              requestedAt: new Date().toISOString(),
              requestedBy: payload.userId,
            }
          ]
        } : undefined
      }
    })
    const activateUser = await resolveRoleToUser(rule.role, projectId)
    await prisma.taskAssignee.create({ data: { taskId: newTask.id, role: rule.role, userId: activateUser.id, isPrimary: true } })

    return successResponse({
      taskId: newTask.id,
      status: newTask.status,
    }, `Created new multi-instance task ${stepCode}`)
  } catch (err) {
    console.error('POST /api/tasks/activate error:', err)
    return errorResponse((err as Error).message || 'Lỗi hệ thống', 500)
  }
}
