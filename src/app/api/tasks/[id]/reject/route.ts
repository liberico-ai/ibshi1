import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { rejectTask } from '@/lib/workflow-engine'
import { WORKFLOW_RULES } from '@/lib/workflow-constants'
import { authenticateRequest } from '@/lib/auth'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = await authenticateRequest(request)
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: taskId } = await params
    const body = await request.json()
    const { reason, overrideRejectTo } = body

    if (!reason) {
      return NextResponse.json(
        { error: 'reason is required' },
        { status: 400 }
      )
    }

    // Verify task exists and is in-progress
    const task = await prisma.workflowTask.findUnique({ where: { id: taskId } })
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    if (task.status !== 'IN_PROGRESS') {
      return NextResponse.json(
        { error: `Task is ${task.status}, can only reject IN_PROGRESS tasks` },
        { status: 400 }
      )
    }

    // Role-based authorization: only the assigned role (or admin) can reject
    if (payload.roleCode !== task.assignedRole && payload.roleCode !== 'R00') {
      return NextResponse.json(
        { error: `Bạn (${payload.roleCode}) không có quyền từ chối bước này. Chỉ ${task.assignedRole} mới được phép.` },
        { status: 403 }
      )
    }

    const rule = WORKFLOW_RULES[task.stepCode]
    if (!rule?.rejectTo && !overrideRejectTo) {
      return NextResponse.json(
        { error: `Step ${task.stepCode} has no reject destination defined` },
        { status: 400 }
      )
    }

    // Use userId from JWT token, not from body
    const result = await rejectTask(taskId, payload.userId, reason, overrideRejectTo)

    const targetRule = WORKFLOW_RULES[result.returnedTo]
    return NextResponse.json({
      success: true,
      returnedTo: result.returnedTo,
      returnedToName: targetRule?.name || result.returnedTo,
      message: `Đã từ chối. Quay về bước ${result.returnedTo}: ${targetRule?.name || ''}`,
    })
  } catch (error) {
    console.error('Reject task error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
