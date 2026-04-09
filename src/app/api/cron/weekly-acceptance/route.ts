import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { WORKFLOW_RULES } from '@/lib/workflow-constants'
import { TASK_STATUS } from '@/lib/constants'

/**
 * WEEKLY ACCEPTANCE CRON JOB
 * Runs every Saturday morning (configured in vercel.json or called manually).
 *
 * Logic:
 * 1. Find all ACTIVE projects that have DailyProductionLog entries this week (Mon→Fri).
 * 2. For each project, create 2 identical tasks:
 *    - P5.3: "NGHIỆM THU KHỐI LƯỢNG TUẦN" assigned to QC (R09)
 *    - P5.4: "NGHIỆM THU KHỐI LƯỢNG TUẦN" assigned to PM (R02)
 * 3. Both tasks carry the same `resultData` with weekStartDate/weekEndDate
 *    so the UI can query the correct DailyProductionLog range.
 *
 * When PM/QC Submit (in the task API):
 * - Their "Khối lượng thực nghiệm" values are saved as immutable
 *   WeeklyAcceptanceLog records (Bảo vệ Dữ liệu Bất khả xâm phạm).
 * - If cumulative accepted volume >= total LSX volume → close that LSX line.
 */

function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

export async function GET(request: Request) {
  // Optional auth check for Vercel Cron
  const authHeader = request.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Calculate this week's Monday → Friday
    const now = new Date()
    const dayOfWeek = now.getDay() // 0=Sun, 6=Sat
    // thisMonday = current date minus (dayOfWeek - 1), or if Sunday (0), minus 6
    const mondayOffset = dayOfWeek === 0 ? -6 : -(dayOfWeek - 1)
    const thisMonday = new Date(now)
    thisMonday.setDate(now.getDate() + mondayOffset)
    thisMonday.setHours(0, 0, 0, 0)

    const thisFriday = new Date(thisMonday)
    thisFriday.setDate(thisMonday.getDate() + 4)
    thisFriday.setHours(23, 59, 59, 999)

    const weekNumber = getISOWeekNumber(now)
    const year = now.getFullYear()

    // 1. Find all active projects
    const activeProjects = await prisma.project.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, projectCode: true, projectName: true },
    })

    let createdCount = 0

    for (const project of activeProjects) {
      // 2. Check if there are any DailyProductionLog entries this week for this project
      const weekLogs = await (prisma as any).dailyProductionLog.findMany({
        where: {
          projectId: project.id,
          reportDate: { gte: thisMonday, lte: thisFriday },
        },
      })

      if (weekLogs.length === 0) continue // No production data this week → skip

      // 3. Check if we already created P5.3/P5.4 for this week+project (idempotent)
      const existingTask = await prisma.workflowTask.findFirst({
        where: {
          projectId: project.id,
          stepCode: { in: ['P5.3', 'P5.4'] },
          resultData: {
            path: ['weekNumber'],
            equals: weekNumber,
          },
        },
      })
      // Prisma JSON filter may not work for all cases; double-check via resultData
      if (existingTask) {
        const rd = existingTask.resultData as Record<string, unknown>
        if (rd?.year === year) continue // Already created for this week
      }

      // 4. Create identical P5.3 (QC) and P5.4 (PM) tasks
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

        const newTask = await prisma.workflowTask.create({
          data: {
            projectId: project.id,
            stepCode: step.code,
            stepName: `NGHIỆM THU KHỐI LƯỢNG TUẦN — W${weekNumber}`,
            stepNameEn: `Weekly Volume Acceptance — W${weekNumber}`,
            assignedRole: rule.role,
            status: TASK_STATUS.IN_PROGRESS,
            startedAt: new Date(),
            deadline: thisSaturday,
            resultData: JSON.parse(JSON.stringify(taskPayload)),
          },
        })

        // Notify users with matching role
        try {
          const users = await prisma.user.findMany({
            where: { roleCode: rule.role, isActive: true },
            select: { id: true },
          })
          if (users.length > 0) {
            await prisma.notification.createMany({
              data: users.map((u) => ({
                userId: u.id,
                title: `📋 Nghiệm thu tuần W${weekNumber}: ${project.projectCode}`,
                message: `Phiếu nghiệm thu khối lượng tuần ${weekNumber} — ${project.projectName} đã sẵn sàng.`,
                type: 'task_assigned',
                linkUrl: `/dashboard/tasks/${newTask.id}`,
              })),
            })
          }
        } catch (err) {
          console.error(`[CRON] ${step.code} notification error:`, err)
        }

        createdCount++
      }
    }

    return NextResponse.json({
      success: true,
      message: `Weekly Acceptance CronJob completed. Created ${createdCount} tasks for ${activeProjects.length} active projects.`,
      weekNumber,
      year,
      range: { from: thisMonday.toISOString(), to: thisFriday.toISOString() },
    })
  } catch (error: any) {
    console.error('Weekly Acceptance Cron Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
