import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, unauthorizedResponse } from '@/lib/auth'
import { whereDoerOverdue } from '@/lib/task-where'

// GET /api/me/pending — việc cần xử lý của user hiện tại (cho dải băng + modal nhắc).
//   pending  = tổng việc đang giao cho tôi còn phải làm
//   overdue  = trong số đó, bao nhiêu việc đã quá hạn (việc GẤP)
//   urgent[] = danh sách việc quá hạn (tối đa 10) để hiện trong modal
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  // Khớp đúng logic tab "assigned" của Hộp việc: assignee theo userId HOẶC role, status còn phải làm.
  const myAssignee = { some: { OR: [{ userId: user.userId }, { role: user.roleCode }] } }
  const pendingWhere = { status: { in: ['OPEN', 'IN_PROGRESS', 'RETURNED'] }, assignees: myAssignee }
  const overdueWhere = { ...whereDoerOverdue(), assignees: myAssignee }

  const [pending, urgentTasks] = await Promise.all([
    prisma.task.count({ where: pendingWhere }),
    prisma.task.findMany({
      where: overdueWhere,
      select: { id: true, title: true, deadline: true, project: { select: { projectCode: true } } },
      orderBy: { deadline: 'asc' },
      take: 10,
    }),
  ])

  const overdue = await prisma.task.count({ where: overdueWhere })

  return successResponse({
    pending,
    overdue,
    urgent: urgentTasks.map((t) => ({
      id: t.id,
      title: t.title,
      deadline: t.deadline,
      projectCode: t.project?.projectCode || null,
    })),
  })
}
