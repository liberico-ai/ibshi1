import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { WORKFLOW_RULES } from '@/lib/workflow-constants'
import prisma from '@/lib/db'

// POST /api/tasks/activate — Create an independent multi-instance task (e.g., P4.5)
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

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

    // CREATE a brand new task for this request, setting status directly to IN_PROGRESS
    const newTask = await prisma.workflowTask.create({
      data: {
        projectId,
        stepCode,
        stepName: rule.name,
        stepNameEn: rule.nameEn,
        status: 'IN_PROGRESS',
        assignedRole: rule.role,
        deadline: rule.deadlineDays
          ? new Date(Date.now() + rule.deadlineDays * 24 * 60 * 60 * 1000)
          : null,
        startedAt: new Date(),
        resultData: materialInfo ? {
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

    return successResponse({
      taskId: newTask.id,
      status: newTask.status,
    }, `Created new multi-instance task ${stepCode}`)
  } catch (err) {
    console.error('POST /api/tasks/activate error:', err)
    return errorResponse((err as Error).message || 'Lỗi hệ thống', 500)
  }
}
