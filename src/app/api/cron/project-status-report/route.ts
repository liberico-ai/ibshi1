import prisma from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { sendGroupMessage, escapeHtml } from '@/lib/telegram'
import { WORKFLOW_RULES, PHASE_LABELS } from '@/lib/workflow-constants'
import { ROLES } from '@/lib/constants'

const DYNAMIC_STEPS = new Set(['P5.1', 'P5.1A', 'P5.1.1', 'P5.2', 'P5.3', 'P5.3A', 'P5.4'])

export async function GET() {
  try {
    const now = new Date()

    const projects = await prisma.project.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, projectCode: true, projectName: true },
      orderBy: { projectCode: 'asc' },
    })

    if (projects.length === 0) {
      await sendGroupMessage('📊 <b>Báo cáo trạng thái dự án</b>\n\nKhông có dự án đang triển khai.')
      return successResponse({ projects: 0 })
    }

    const tasks = await prisma.workflowTask.findMany({
      where: {
        projectId: { in: projects.map(p => p.id) },
        status: 'IN_PROGRESS',
        stepCode: { notIn: [...DYNAMIC_STEPS] },
      },
      select: {
        projectId: true,
        stepCode: true,
        stepName: true,
        assignedRole: true,
        startedAt: true,
        updatedAt: true,
        deadline: true,
      },
      orderBy: { startedAt: 'asc' },
    })

    const tasksByProject = new Map<string, typeof tasks>()
    for (const t of tasks) {
      const list = tasksByProject.get(t.projectId) || []
      if (!list.some(existing => existing.stepCode === t.stepCode)) {
        list.push(t)
      }
      tasksByProject.set(t.projectId, list)
    }

    const lines: string[] = []
    lines.push('📊 <b>BÁO CÁO TRẠNG THÁI DỰ ÁN</b>')
    lines.push(`🕐 ${now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`)
    lines.push(`━━━━━━━━━━━━━━━━━━━━`)

    let stuckCount = 0

    for (const project of projects) {
      const projectTasks = tasksByProject.get(project.id)

      if (!projectTasks || projectTasks.length === 0) {
        lines.push('')
        lines.push(`🔵 <b>${escapeHtml(project.projectCode)}</b> — ${escapeHtml(project.projectName)}`)
        lines.push(`   ⚠️ Không có task IN_PROGRESS (có thể đang chờ gate)`)
        stuckCount++
        continue
      }

      lines.push('')
      lines.push(`🟢 <b>${escapeHtml(project.projectCode)}</b> — ${escapeHtml(project.projectName)}`)

      for (const task of projectTasks) {
        const rule = WORKFLOW_RULES[task.stepCode]
        const phase = rule ? PHASE_LABELS[rule.phase]?.name || `Phase ${rule.phase}` : '—'
        const roleInfo = (ROLES as Record<string, { name: string }>)[task.assignedRole]
        const roleName = roleInfo?.name || task.assignedRole

        const refDate = task.startedAt || task.updatedAt
        const staleDays = refDate
          ? Math.floor((now.getTime() - new Date(refDate).getTime()) / (1000 * 60 * 60 * 24))
          : 0

        let staleIcon = '✅'
        if (staleDays >= 7) { staleIcon = '🔴'; stuckCount++ }
        else if (staleDays >= 3) { staleIcon = '🟡' }

        const deadlineStr = task.deadline
          ? new Date(task.deadline).toLocaleDateString('vi-VN')
          : '—'
        const isOverdue = task.deadline && new Date(task.deadline) < now

        let line = `   ${staleIcon} <b>${task.stepCode}</b> ${escapeHtml(task.stepName)}`
        line += `\n      📌 ${escapeHtml(phase)} · 👤 ${escapeHtml(roleName)}`
        line += ` · ⏱ ${staleDays} ngày`
        if (isOverdue) line += ` · ⏰ <b>QUÁ HẠN</b> (DL: ${deadlineStr})`
        else if (task.deadline) line += ` · DL: ${deadlineStr}`

        lines.push(line)
      }
    }

    lines.push('')
    lines.push(`━━━━━━━━━━━━━━━━━━━━`)
    lines.push(`📈 Tổng: <b>${projects.length}</b> dự án · <b>${tasks.length}</b> tasks đang chạy · <b>${stuckCount}</b> cần chú ý`)
    lines.push(`\n🔴 &gt;= 7 ngày · 🟡 &gt;= 3 ngày · ✅ &lt; 3 ngày`)

    const message = lines.join('\n')

    if (message.length > 4096) {
      const chunks: string[] = []
      let current = ''
      for (const line of lines) {
        if ((current + '\n' + line).length > 4000) {
          chunks.push(current)
          current = line
        } else {
          current += (current ? '\n' : '') + line
        }
      }
      if (current) chunks.push(current)
      for (const chunk of chunks) {
        await sendGroupMessage(chunk)
      }
    } else {
      await sendGroupMessage(message)
    }

    return successResponse({
      projects: projects.length,
      activeTasks: tasks.length,
      stuckCount,
      sentAt: now.toISOString(),
    })
  } catch (err) {
    console.error('GET /api/cron/project-status-report error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
