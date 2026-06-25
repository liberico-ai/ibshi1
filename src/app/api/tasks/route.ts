import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { getTaskInbox } from '@/lib/task-engine'
import { withCache } from '@/lib/cache'
import { isTaskOverdue } from '@/lib/utils'

// GET /api/tasks — Task inbox for current user
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const stepCode = searchParams.get('stepCode')
    const excludeStep = searchParams.get('excludeStep')

    const data = await withCache(`tasks:inbox:${payload.userId}:${stepCode}:${excludeStep}`, 30, async () => {
      let tasks = await getTaskInbox(payload.userId, payload.roleCode)
      
      if (stepCode) {
        tasks = tasks.filter(t => t.stepCode === stepCode)
      }
      if (excludeStep) {
        tasks = tasks.filter(t => t.stepCode !== excludeStep)
      }

      // Categorize by urgency
      const now = new Date()
      const categorized = tasks.map((t) => {
        let urgency: 'overdue' | 'today' | 'this_week' | 'normal' = 'normal'
        if (isTaskOverdue(t)) { urgency = 'overdue' }
        else if (t.deadline) {
          const diffHours = (new Date(t.deadline).getTime() - now.getTime()) / 3600000
          if (diffHours >= 0 && diffHours < 24) urgency = 'today'
          else if (diffHours >= 0 && diffHours < 168) urgency = 'this_week'
        }
        return { ...t, urgency }
      })

      // Sort: overdue first, then today, then this_week, then normal
      const urgencyOrder = { overdue: 0, today: 1, this_week: 2, normal: 3 }
      categorized.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency])

      return { tasks: categorized }
    })

    return successResponse(data)
  } catch (err) {
    console.error('GET /api/tasks error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
