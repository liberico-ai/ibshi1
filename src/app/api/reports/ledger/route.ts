import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { accountGroup } from '@/lib/misa-ledger-parser'

export const dynamic = 'force-dynamic'
const VIEW_ROLES = ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R08', 'R08a', 'R10']
const EDIT_ROLES = ['R01', 'R03', 'R03a', 'R08', 'R08a', 'R10']

// Thứ tự nhóm chi phí hiển thị
const GROUP_ORDER = ['VT', 'NC', 'MTC', 'SXC', 'DD', 'GV', 'BH', 'QLDN', 'DT', 'PT', 'KHAC']

// GET /api/reports/ledger?batchId=&projectId=  → danh sách lô + chi phí theo dự án (net = Nợ − Có)
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, VIEW_ROLES)) return errorResponse('Không có quyền xem báo cáo chi phí', 403)

  const url = new URL(req.url)
  const batchId = url.searchParams.get('batchId') || undefined
  const projectId = url.searchParams.get('projectId') || undefined

  const [batchesRaw, entries, projects] = await Promise.all([
    prisma.ledgerImportBatch.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.ledgerEntry.findMany({
      where: { ...(batchId ? { batchId } : {}), ...(projectId ? { projectId } : {}) },
      select: { projectId: true, vuViec: true, account: true, contraAccount: true, debit: true, credit: true },
    }),
    prisma.project.findMany({ select: { id: true, projectCode: true, projectName: true } }),
  ])

  // Tên người nhập
  const userIds = [...new Set(batchesRaw.map(b => b.importedBy))]
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : []
  const userMap = new Map(users.map(u => [u.id, u.fullName]))
  const batches = batchesRaw.map(b => ({
    id: b.id, fileName: b.fileName, note: b.note, rowCount: b.rowCount, matchedRows: b.matchedRows,
    totalDebit: Number(b.totalDebit), totalCredit: Number(b.totalCredit),
    importedByName: userMap.get(b.importedBy) || '—', createdAt: b.createdAt,
  }))

  const projMap = new Map(projects.map(p => [p.id, p]))

  // Gộp theo (dự án) × (nhóm TK): net = debit − credit.
  // LOẠI bút toán KẾT CHUYỂN cuối kỳ (TK hoặc đối ứng 154) — không phải chi phí phát sinh, chỉ chuyển sổ.
  const isCarryForward = (account: string, contra: string | null) =>
    account.startsWith('154') || (contra || '').startsWith('154')
  type Grp = { debit: number; credit: number }
  const byProject = new Map<string, { code: string; name: string; groups: Map<string, Grp>; total: number }>()
  const groupsSeen = new Set<string>()
  const key = (pid: string | null) => pid || '__none__'
  for (const e of entries) {
    if (isCarryForward(e.account, e.contraAccount)) continue
    const g = accountGroup(e.account); groupsSeen.add(g.code)
    const pk = key(e.projectId)
    if (!byProject.has(pk)) {
      const p = e.projectId ? projMap.get(e.projectId) : null
      byProject.set(pk, { code: p?.projectCode || '—', name: p?.projectName || 'Chưa khớp vụ việc', groups: new Map(), total: 0 })
    }
    const row = byProject.get(pk)!
    const cur = row.groups.get(g.code) || { debit: 0, credit: 0 }
    cur.debit += Number(e.debit); cur.credit += Number(e.credit)
    row.groups.set(g.code, cur)
  }

  const groupCols = GROUP_ORDER.filter(c => groupsSeen.has(c))
  const groupLabels: Record<string, string> = {}
  for (const c of groupCols) groupLabels[c] = accountGroupLabel(c)

  const projectsOut = [...byProject.entries()].map(([pk, v]) => {
    const groups: Record<string, number> = {}
    let total = 0
    for (const c of groupCols) {
      const gg = v.groups.get(c)
      const net = gg ? gg.debit - gg.credit : 0
      groups[c] = Math.round(net)
      total += net
    }
    return { projectId: pk === '__none__' ? null : pk, projectCode: v.code, projectName: v.name, groups, total: Math.round(total) }
  }).sort((a, b) => {
    if (a.projectId === null) return 1
    if (b.projectId === null) return -1
    return b.total - a.total
  })

  return successResponse({
    batches, projects: projectsOut, groupCols, groupLabels,
    hasData: entries.length > 0,
    canEdit: requireRoles(user.roleCode, EDIT_ROLES),
  })
}

// DELETE /api/reports/ledger?batchId=  → xóa 1 lô (cascade entries)
export async function DELETE(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, EDIT_ROLES)) return errorResponse('Không có quyền xóa bảng kê', 403)
  const batchId = new URL(req.url).searchParams.get('batchId') || ''
  if (!batchId) return errorResponse('Thiếu batchId', 400)
  const b = await prisma.ledgerImportBatch.findUnique({ where: { id: batchId }, select: { id: true } })
  if (!b) return errorResponse('Không tìm thấy lô nhập', 404)
  await prisma.ledgerImportBatch.delete({ where: { id: batchId } })
  return successResponse({ batchId }, 'Đã xóa lô bảng kê')
}

function accountGroupLabel(code: string): string {
  // dò nhãn từ 1 tài khoản đại diện của nhóm
  const rep: Record<string, string> = { VT: '621', NC: '622', MTC: '623', SXC: '627', DD: '154', GV: '632', BH: '641', QLDN: '642', DT: '511', PT: '131', KHAC: '000' }
  return accountGroup(rep[code] || '000').label
}
