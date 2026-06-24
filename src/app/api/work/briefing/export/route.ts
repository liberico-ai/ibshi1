import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, unauthorizedResponse, forbiddenResponse } from '@/lib/auth'
import { ROLE_TO_DEPT, DEPT_NAME } from '@/lib/org-map'
import * as XLSX from 'xlsx'
import { taskDaysOverdue } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOWED_ROLES = ['R01', 'R02', 'R02a', 'R10']

function deptLabelForRole(roleCode: string): string {
  const deptCode = ROLE_TO_DEPT[roleCode]
  return deptCode ? (DEPT_NAME[deptCode] || deptCode) : ''
}

function statusLabel(status: string, blocked: boolean): string {
  if (status === 'IN_PROGRESS' && blocked) return 'Tắc'
  if (status === 'OPEN') return 'Mới'
  if (status === 'IN_PROGRESS') return 'Đang xử lý'
  if (status === 'AWAITING_REVIEW') return 'Chờ kết thúc'
  if (status === 'RETURNED') return 'Bị trả lại'
  if (status === 'DONE') return 'Xong'
  return status
}

export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!ALLOWED_ROLES.includes(payload.roleCode)) return forbiddenResponse('Chỉ PM / BGĐ được xuất biên bản')

    const now = new Date()

    const overdueTasks = await prisma.task.findMany({
      where: {
        status: { notIn: ['CANCELLED'] },
      },
      include: {
        project: { select: { projectCode: true, projectName: true } },
        assignees: true,
      },
      orderBy: [{ projectId: 'asc' }, { deadline: 'asc' }],
    })

    const uids = new Set<string>()
    for (const t of overdueTasks) {
      for (const a of t.assignees) if (a.userId) uids.add(a.userId)
    }
    const users = uids.size ? await prisma.user.findMany({ where: { id: { in: [...uids] } }, select: { id: true, fullName: true } }) : []
    const nameById = new Map(users.map((u) => [u.id, u.fullName]))

    const rows = overdueTasks.map((t, idx) => {
      const daysOverdue = taskDaysOverdue(t)
      const assigneeNames = t.assignees.map((a) =>
        a.userId ? (nameById.get(a.userId) || 'NV') : (DEPT_NAME[ROLE_TO_DEPT[a.role || '']] || a.role || '—')
      ).join(', ')
      const rd = (t.resultData && typeof t.resultData === 'object') ? t.resultData as Record<string, unknown> : {}
      const briefing = (rd.briefing && typeof rd.briefing === 'object') ? rd.briefing as Record<string, string> : {}
      const deptRole = briefing.deptRole || ''

      return {
        'STT': idx + 1,
        'ID hệ thống': t.id,
        'Dự án': t.project?.projectCode || 'Công việc chung',
        'Tên dự án': t.project?.projectName || '',
        'Nội dung công việc': t.title,
        'Phòng xử lý': deptLabelForRole(deptRole),
        'Người thực hiện': assigneeNames,
        'Ngày mở': t.startedAt ? formatDate(t.startedAt) : formatDate(t.createdAt),
        'Hạn': t.deadline ? formatDate(t.deadline) : '',
        'Số ngày quá hạn': daysOverdue > 0 ? daysOverdue : '',
        'Trạng thái': statusLabel(t.status, t.blocked),
        'Tiêu chí hoàn thành': briefing.criteria || '',
        'Đề xuất/hướng xử lý': briefing.proposal || '',
        'Quyết định BGĐ': briefing.decision || '',
        'Ghi chú': briefing.notes || '',
      }
    })

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(rows)

    ws['!cols'] = [
      { wch: 5 },   // STT
      { wch: 28 },  // ID hệ thống
      { wch: 18 },  // Dự án
      { wch: 24 },  // Tên dự án
      { wch: 40 },  // Nội dung công việc
      { wch: 14 },  // Phòng xử lý
      { wch: 20 },  // Người thực hiện
      { wch: 12 },  // Ngày mở
      { wch: 12 },  // Hạn
      { wch: 8 },   // Số ngày quá hạn
      { wch: 14 },  // Trạng thái
      { wch: 25 },  // Tiêu chí hoàn thành
      { wch: 25 },  // Đề xuất/hướng xử lý
      { wch: 25 },  // Quyết định BGĐ
      { wch: 25 },  // Ghi chú
    ]

    XLSX.utils.book_append_sheet(wb, ws, 'Giao ban tuần')

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')
    const filename = `Giao_ban_tuan_${dateStr}.xlsx`

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
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

function formatDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  return `${day}/${month}/${year}`
}
