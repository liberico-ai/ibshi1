import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, unauthorizedResponse, forbiddenResponse } from '@/lib/auth'
import { ROLE_TO_DEPT, DEPT_NAME } from '@/lib/org-map'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOWED_ROLES = ['R01', 'R02', 'R02a', 'R10']

const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Mới',
  IN_PROGRESS: 'Đang xử lý',
  AWAITING_REVIEW: 'Chờ kết thúc',
  RETURNED: 'Bị trả lại',
}

export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!ALLOWED_ROLES.includes(payload.roleCode)) return forbiddenResponse('Chỉ PM / BGĐ được xuất biên bản')

    const now = new Date()

    const overdueTasks = await prisma.task.findMany({
      where: {
        deadline: { lt: now },
        status: { notIn: ['DONE', 'CANCELLED'] },
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
      const daysOverdue = Math.ceil((now.getTime() - new Date(t.deadline!).getTime()) / 86400000)
      const assigneeNames = t.assignees.map((a) =>
        a.userId ? (nameById.get(a.userId) || 'NV') : (DEPT_NAME[ROLE_TO_DEPT[a.role || '']] || a.role || '—')
      ).join(', ')
      const rd = (t.resultData && typeof t.resultData === 'object') ? t.resultData as Record<string, unknown> : {}
      const briefing = (rd.briefing && typeof rd.briefing === 'object') ? rd.briefing as Record<string, string> : {}

      return {
        'STT': idx + 1,
        'Mã việc': t.taskType !== 'FREE' ? t.taskType : '',
        'Dự án': t.project?.projectCode || 'Công việc chung',
        'Nội dung': t.title,
        'Người thực hiện': assigneeNames,
        'Ngày mở': t.startedAt ? formatDate(t.startedAt) : formatDate(t.createdAt),
        'Hạn': t.deadline ? formatDate(t.deadline) : '',
        'Số ngày quá hạn': daysOverdue,
        'Trạng thái': STATUS_LABELS[t.status] || t.status,
        'Tiêu chí xong': briefing.criteria || '',
        'Đề xuất': briefing.proposal || '',
        'Quyết định BGĐ': briefing.decision || '',
        'Ghi chú': briefing.notes || '',
        'ID hệ thống': t.id,
      }
    })

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(rows)

    ws['!cols'] = [
      { wch: 5 },   // STT
      { wch: 10 },  // Mã việc
      { wch: 18 },  // Dự án
      { wch: 40 },  // Nội dung
      { wch: 20 },  // Người thực hiện
      { wch: 12 },  // Ngày mở
      { wch: 12 },  // Hạn
      { wch: 8 },   // Số ngày quá hạn
      { wch: 14 },  // Trạng thái
      { wch: 25 },  // Tiêu chí xong
      { wch: 25 },  // Đề xuất
      { wch: 25 },  // Quyết định BGĐ
      { wch: 25 },  // Ghi chú
      { wch: 28 },  // ID hệ thống
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
