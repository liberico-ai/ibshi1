import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'

// GET /api/cron/deadline-check — Check overdue tasks and generate notifications
// Called by external cron or Vercel cron every 15 minutes
export async function GET(req: NextRequest) {
  try {
    const cronSecret = req.headers.get('x-cron-secret')
    const expectedSecret = process.env.CRON_SECRET || 'ibs-cron-2026'
    if (cronSecret && cronSecret !== expectedSecret) {
      return errorResponse('Invalid cron secret', 401)
    }

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
