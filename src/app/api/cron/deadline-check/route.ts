import prisma from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { notifyTaskOverdue } from '@/lib/telegram-notifications'

// GET /api/cron/deadline-check — Check overdue tasks and generate notifications
// Called by external cron or Vercel cron every 15 minutes
// Note: cron secret validation is handled by middleware
export async function GET() {
  try {

    const now = new Date()

    const overdueTasks = await prisma.workflowTask.findMany({
      where: {
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        deadline: { lt: now },
      },
      include: {
        project: { select: { projectCode: true, projectName: true } },
      },
      take: 100,
    })

    let notificationsCreated = 0

    for (const task of overdueTasks) {
      const hoursOverdue = Math.round((now.getTime() - new Date(task.deadline!).getTime()) / (1000 * 60 * 60))
      const taskUrl = `/dashboard/projects/${task.projectId}`

      // Notify assigned user
      if (task.assignedTo) {
        const existing = await prisma.notification.findFirst({
          where: {
            userId: task.assignedTo,
            type: 'DEADLINE_ALERT',
            linkUrl: taskUrl,
            createdAt: { gte: new Date(now.getTime() - 15 * 60 * 1000) },
          },
        })

        if (!existing) {
          await prisma.notification.create({
            data: {
              userId: task.assignedTo,
              title: `⏰ Quá hạn: ${task.stepName}`,
              message: `Task "${task.stepName}" dự án ${task.project.projectCode} đã quá hạn ${hoursOverdue}h`,
              type: 'DEADLINE_ALERT',
              linkUrl: taskUrl,
            },
          })
          notificationsCreated++
          // Push to Telegram group (fire-and-forget)
          notifyTaskOverdue({
            stepCode: task.stepCode, stepName: task.stepName,
            projectCode: task.project.projectCode, projectName: task.project.projectName,
            assignedRole: task.assignedRole, hoursOverdue,
          }).catch(() => {})
        }
      }

      // Auto-escalation: overdue > 48h → notify R01
      if (hoursOverdue > 48) {
        const r01Users = await prisma.user.findMany({
          where: { roleCode: 'R01', isActive: true },
          select: { id: true },
        })

        for (const admin of r01Users) {
          const existing = await prisma.notification.findFirst({
            where: {
              userId: admin.id,
              type: 'ESCALATION',
              linkUrl: taskUrl,
              createdAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) },
            },
          })

          if (!existing) {
            await prisma.notification.create({
              data: {
                userId: admin.id,
                title: `🚨 Leo thang: ${task.stepName}`,
                message: `Task "${task.stepName}" dự án ${task.project.projectCode} quá hạn ${hoursOverdue}h, cần can thiệp BGĐ`,
                type: 'ESCALATION',
                linkUrl: taskUrl,
              },
            })
            notificationsCreated++
          }
        }
      }
    }

    return successResponse({
      overdueTasks: overdueTasks.length,
      notificationsCreated,
      checkedAt: now.toISOString(),
    })
  } catch (err) {
    console.error('GET /api/cron/deadline-check error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
