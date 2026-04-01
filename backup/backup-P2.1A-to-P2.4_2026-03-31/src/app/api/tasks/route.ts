import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { getTaskInbox } from '@/lib/task-engine'

// GET /api/tasks — Task inbox for current user
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const tasks = await getTaskInbox(payload.userId, payload.roleCode)

    // Categorize by urgency
    const now = new Date()
    const categorized = tasks.map((t) => {
      let urgency: 'overdue' | 'today' | 'this_week' | 'normal' = 'normal'
      if (t.deadline) {
        const dl = new Date(t.deadline)
        const diffMs = dl.getTime() - now.getTime()
        const diffHours = diffMs / (1000 * 60 * 60)
        if (diffHours < 0) urgency = 'overdue'
        else if (diffHours < 24) urgency = 'today'
        else if (diffHours < 168) urgency = 'this_week'
      }
      return { ...t, urgency }
    })

    // Sort: overdue first, then today, then this_week, then normal
    const urgencyOrder = { overdue: 0, today: 1, this_week: 2, normal: 3 }
    categorized.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency])

    return successResponse({ tasks: categorized })
  } catch (err) {
    console.error('GET /api/tasks error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
