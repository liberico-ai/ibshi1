import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, unauthorizedResponse } from '@/lib/auth'
import { ROLE_TO_DEPT, DEPT_NAME } from '@/lib/org-map'
import * as XLSX from 'xlsx'
import { isTaskOverdue, taskDaysOverdue } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function statusLabel(status: string, blocked: boolean): string {
  if (status === 'IN_PROGRESS' && blocked) return 'Tắc'
  if (status === 'OPEN') return 'Mới'
  if (status === 'IN_PROGRESS') return 'Đang xử lý'
  if (status === 'AWAITING_REVIEW') return 'Chờ kết thúc'
  if (status === 'RETURNED') return 'Bị trả lại'
  if (status === 'DONE') return 'Xong'
  return status
}

function fmtDate(d: Date | string | null): string {
  if (!d) return ''
  const dt = typeof d === 'string' ? new Date(d) : d
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`
}

function getMonday(d: Date = new Date()): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  const day = out.getDay()
  out.setDate(out.getDate() - day + (day === 0 ? -6 : 1))
  return out
}

interface SnapDecision { taskId: string; title: string; decision: string; byName: string; at: string }
interface SnapActionItem { taskId: string; sourceTaskId: string; title: string; assigneeNames: string[] }
interface SnapTask { taskId: string; projectCode: string; title: string; status: string; deadline: string | null; daysOverdue: number; assigneeNames: string[] }

export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const now = new Date()
    const weekOf = getMonday()
    const snapshot = await prisma.briefingSnapshot.findUnique({ where: { weekOf } })

    const callerUser = await prisma.user.findUnique({ where: { id: payload.userId }, select: { fullName: true } })
    const chairName = callerUser?.fullName || payload.username || 'PM'

    const wb = XLSX.utils.book_new()

    // ════════════ SHEET 1: BIÊN BẢN CÓ CẤU TRÚC ════════════
    const momRows: (string | number)[][] = []

    momRows.push(['BIÊN BẢN GIAO BAN TUẦN'])
    momRows.push([`Ngày: ${fmtDate(now)}`])
    momRows.push([`Người chủ trì: ${chairName}`])
    momRows.push(['Người dự: '])
    momRows.push([])

    if (snapshot) {
      const decisions = (snapshot.decisions as unknown as SnapDecision[]) || []
      const actionItems = (snapshot.actionItems as unknown as SnapActionItem[]) || []
      const snTasks = (snapshot.tasksSnapshot as unknown as SnapTask[]) || []
      const kpi = snapshot.kpi as Record<string, number>

      // Mục A: Quyết định
      momRows.push(['A. QUYẾT ĐỊNH'])
      if (decisions.length > 0) {
        momRows.push(['STT', 'Nội dung', 'Quyết định', 'Người quyết', 'Ngày'])
        decisions.forEach((d, i) => {
          momRows.push([i + 1, d.title, String(d.decision), d.byName, fmtDate(d.at)])
        })
      } else {
        momRows.push(['(Không có quyết định trong kỳ)'])
      }
      momRows.push([])

      // Mục B: Việc giao
      momRows.push(['B. VIỆC GIAO (ACTION ITEMS)'])
      if (actionItems.length > 0) {
        momRows.push(['STT', 'Nội dung', 'Người nhận', 'Hạn'])
        // Resolve deadlines from actual tasks
        const aiTaskIds = actionItems.map(ai => ai.taskId)
        const aiTasks = aiTaskIds.length > 0 ? await prisma.task.findMany({
          where: { id: { in: aiTaskIds } },
          select: { id: true, deadline: true, assignees: { select: { userId: true } } },
        }) : []
        const aiTaskMap = new Map(aiTasks.map(t => [t.id, t]))

        // Also resolve user names
        const aiUserIds = new Set<string>()
        for (const t of aiTasks) for (const a of t.assignees) if (a.userId) aiUserIds.add(a.userId)
        const aiUsers = aiUserIds.size > 0 ? await prisma.user.findMany({ where: { id: { in: [...aiUserIds] } }, select: { id: true, fullName: true } }) : []
        const aiNameById = new Map(aiUsers.map(u => [u.id, u.fullName]))

        actionItems.forEach((ai, i) => {
          const task = aiTaskMap.get(ai.taskId)
          const names = task ? task.assignees.map(a => a.userId ? (aiNameById.get(a.userId) || 'NV') : '—').join(', ') : ai.assigneeNames.join(', ')
          momRows.push([i + 1, ai.title, names, task?.deadline ? fmtDate(task.deadline) : ''])
        })
      } else {
        momRows.push(['(Không có việc giao trong kỳ)'])
      }
      momRows.push([])

      // Mục C: Cần BGĐ quyết
      momRows.push(['C. VIỆC CẦN BGĐ QUYẾT ĐỊNH'])
      const execTasks = snTasks.filter(t => {
        const overdue = t.daysOverdue > 0 && t.status !== 'DONE'
        return t.status !== 'DONE' && t.status !== 'CANCELLED' && (overdue && t.daysOverdue >= 14)
      })
      if ((kpi.execDecision || 0) > 0 || execTasks.length > 0) {
        momRows.push(['STT', 'Dự án', 'Nội dung', 'Trạng thái', 'Quá hạn (ngày)', 'Người thực hiện'])
        execTasks.forEach((t, i) => {
          momRows.push([i + 1, t.projectCode, t.title, t.status, t.daysOverdue > 0 ? t.daysOverdue : '', t.assigneeNames.join(', ')])
        })
        if (execTasks.length === 0) momRows.push(['(Đã xử lý hết trong kỳ)'])
      } else {
        momRows.push(['(Không có)'])
      }
      momRows.push([])
    } else {
      momRows.push(['(Kỳ chưa được chốt — dữ liệu tính live)'])
      momRows.push([])
    }

    const wsMom = XLSX.utils.aoa_to_sheet(momRows)
    wsMom['!cols'] = [{ wch: 5 }, { wch: 40 }, { wch: 35 }, { wch: 20 }, { wch: 15 }, { wch: 20 }]
    // Merge header row
    wsMom['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }]
    XLSX.utils.book_append_sheet(wb, wsMom, 'Biên bản')

    // ════════════ SHEET 2: TỔNG HỢP THEO DỰ ÁN (dump cũ) ════════════
    const allTasks = await prisma.task.findMany({
      where: { status: { notIn: ['CANCELLED'] } },
      include: {
        project: { select: { projectCode: true, projectName: true } },
        assignees: true,
      },
      orderBy: [{ projectId: 'asc' }, { deadline: 'asc' }],
    })

    const uids = new Set<string>()
    for (const t of allTasks) for (const a of t.assignees) if (a.userId) uids.add(a.userId)
    const users = uids.size ? await prisma.user.findMany({ where: { id: { in: [...uids] } }, select: { id: true, fullName: true } }) : []
    const nameById = new Map(users.map(u => [u.id, u.fullName]))

    const dumpRows = allTasks.map((t, idx) => {
      const daysOverdue = taskDaysOverdue(t)
      const assigneeNames = t.assignees.map(a =>
        a.userId ? (nameById.get(a.userId) || 'NV') : (DEPT_NAME[ROLE_TO_DEPT[a.role || '']] || a.role || '—')
      ).join(', ')
      const rd = (t.resultData && typeof t.resultData === 'object') ? t.resultData as Record<string, unknown> : {}
      const briefing = (rd.briefing && typeof rd.briefing === 'object') ? rd.briefing as Record<string, string> : {}

      return {
        'STT': idx + 1,
        'Dự án': t.project?.projectCode || 'Công việc chung',
        'Tên dự án': t.project?.projectName || '',
        'Nội dung công việc': t.title,
        'Người thực hiện': assigneeNames,
        'Hạn': t.deadline ? fmtDate(t.deadline) : '',
        'Quá hạn': daysOverdue > 0 ? daysOverdue : '',
        'Trạng thái': statusLabel(t.status, t.blocked),
        'Quá hạn?': isTaskOverdue(t) ? 'Có' : '',
        'Đề xuất': briefing.proposal || '',
        'Quyết định': briefing.decision || '',
        'Ghi chú': briefing.notes || '',
      }
    })

    const wsDump = XLSX.utils.json_to_sheet(dumpRows)
    wsDump['!cols'] = [
      { wch: 5 }, { wch: 14 }, { wch: 24 }, { wch: 40 }, { wch: 20 },
      { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 8 }, { wch: 25 }, { wch: 25 }, { wch: 25 },
    ]
    XLSX.utils.book_append_sheet(wb, wsDump, 'Tổng hợp theo DA')

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Bien_ban_giao_ban_${dateStr}.xlsx"`,
      },
    })
  } catch (err) {
    console.error('GET /api/work/briefing/export error:', err)
    return new NextResponse(JSON.stringify({ ok: false, error: 'Lỗi hệ thống' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
