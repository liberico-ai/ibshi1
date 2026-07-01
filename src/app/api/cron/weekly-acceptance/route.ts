import prisma from '@/lib/db'
import { WORKFLOW_RULES } from '@/lib/workflow-constants'
import { notifyTaskActivated } from '@/lib/telegram-notifications'
import { successResponse, errorResponse } from '@/lib/auth'
import { resolveRoleToUser } from '@/lib/work-engine'

function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

export async function GET() {
  try {
    const now = new Date()
    const dayOfWeek = now.getDay()
    const mondayOffset = dayOfWeek === 0 ? -6 : -(dayOfWeek - 1)
    const thisMonday = new Date(now)
    thisMonday.setDate(now.getDate() + mondayOffset)
    thisMonday.setHours(0, 0, 0, 0)

    const thisFriday = new Date(thisMonday)
    thisFriday.setDate(thisMonday.getDate() + 4)
    thisFriday.setHours(23, 59, 59, 999)

    const weekNumber = getISOWeekNumber(now)
    const year = now.getFullYear()

    const activeProjects = await prisma.project.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, projectCode: true, projectName: true },
    })

    let createdCount = 0

    for (const project of activeProjects) {
      const weekLogs = await (prisma as any).dailyProductionLog.findMany({
        where: {
          projectId: project.id,
          reportDate: { gte: thisMonday, lte: thisFriday },
        },
      })

      if (weekLogs.length === 0) continue

      // Check if we already created P5.3 for this week+project (idempotent)
      const existingTask = await prisma.task.findFirst({
        where: {
          projectId: project.id,
          taskType: { in: ['P5.3', 'P5.4'] },
          resultData: {
            path: ['weekNumber'],
            equals: weekNumber,
          },
        },
      })
      if (existingTask) {
        const rdCheck = existingTask.resultData as Record<string, unknown>
        if (rdCheck?.year === year) continue
      }

      const taskPayload = {
        weekNumber,
        year,
        weekStartDate: thisMonday.toISOString(),
        weekEndDate: thisFriday.toISOString(),
        projectCode: project.projectCode,
        projectName: project.projectName,
      }

      const stepsToCreate: { code: 'P5.3' }[] = [
        { code: 'P5.3' },
      ]

      const thisSaturday = new Date(thisMonday)
      thisSaturday.setDate(thisMonday.getDate() + 5)
      thisSaturday.setHours(23, 59, 59, 999)

      for (const step of stepsToCreate) {
        const rule = WORKFLOW_RULES[step.code]
        if (!rule) continue

        const newTask = await prisma.task.create({
          data: {
            projectId: project.id,
            level: 2,
            taskType: step.code,
            title: `NGHIỆM THU KHỐI LƯỢNG TUẦN — W${weekNumber}`,
            priority: 'NORMAL',
            createdBy: 'SYSTEM',
            assignedAt: new Date(),
            status: 'IN_PROGRESS',
            startedAt: new Date(),
            deadline: thisSaturday,
            resultData: JSON.parse(JSON.stringify(taskPayload)),
          },
        })
        const cronUser = await resolveRoleToUser(rule.role, project.id)
        await prisma.taskAssignee.create({
          data: { taskId: newTask.id, role: rule.role, userId: cronUser.id, isPrimary: true },
        })
        await prisma.taskHistory.create({
          data: { taskId: newTask.id, action: 'CREATED', byUserId: 'SYSTEM', toRole: rule.role },
        })

        try {
          const users = await prisma.user.findMany({
            where: { roleCode: rule.role, isActive: true },
            select: { id: true, username: true, telegramChatId: true },
          })
          if (users.length > 0) {
            await prisma.notification.createMany({
              data: users.map((u) => ({
                userId: u.id,
                title: `Nghiệm thu tuần W${weekNumber}: ${project.projectCode}`,
                message: `Phiếu nghiệm thu khối lượng tuần ${weekNumber} — ${project.projectName} đã sẵn sàng.`,
                type: 'task_assigned',
                linkUrl: `/dashboard/work/${newTask.id}`,
              })),
            })

            try {
              await notifyTaskActivated({
                stepCode: step.code,
                stepName: newTask.title,
                projectCode: project.projectCode,
                projectName: project.projectName,
                assignedRole: rule.role,
                deadline: newTask.deadline,
                taskId: newTask.id,
                mentionUsers: users.map(u => ({
                  fullName: u.username,
                  telegramChatId: u.telegramChatId
                }))
              })
            } catch (err) {
              console.error('[CRON] Telegram notification error:', err)
            }
          }
        } catch (err) {
          console.error(`[CRON] ${step.code} notification error:`, err)
        }

        createdCount++
      }
    }

    return successResponse({
      message: `Weekly Acceptance CronJob completed. Created ${createdCount} tasks for ${activeProjects.length} active projects.`,
      weekNumber,
      year,
      range: { from: thisMonday.toISOString(), to: thisFriday.toISOString() },
    })
  } catch (error: any) {
    console.error('Weekly Acceptance Cron Error:', error)
    return errorResponse(error.message || 'Internal server error', 500)
  }
}