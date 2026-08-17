import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'

// Danh mục "Báo cáo quản trị" (mô phỏng file BaoCaoQuanTri_IBS) + bảng tổng hợp theo phòng & tần suất.
const EDIT_ROLES = ['R01', 'R03', 'R03a', 'R10'] // KTKH + BGĐ + IT quản trị danh mục

// Thứ tự tần suất chuẩn (để tổng hợp hiển thị nhất quán với file gốc)
const FREQ_ORDER = ['Ngày', 'Tuần', 'Tháng', 'Quý', '6 tháng', 'Năm', 'Đột xuất']

// GET /api/reports/management — danh mục + tổng hợp
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const reports = await prisma.managementReport.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })

  const total = reports.length
  // Tổng hợp theo phòng
  const deptMap = new Map<string, number>()
  for (const r of reports) deptMap.set(r.department, (deptMap.get(r.department) || 0) + 1)
  const byDept = [...deptMap.entries()]
    .map(([department, count]) => ({ department, count, pct: total > 0 ? Math.round((count / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.count - a.count)
  // Tổng hợp theo tần suất (giữ thứ tự chuẩn; tần suất trống gộp vào "Không định kỳ")
  const freqMap = new Map<string, number>()
  for (const r of reports) { const f = (r.frequency || '').trim() || 'Không định kỳ'; freqMap.set(f, (freqMap.get(f) || 0) + 1) }
  const byFreq = [...freqMap.entries()]
    .map(([frequency, count]) => ({ frequency, count }))
    .sort((a, b) => {
      const ia = FREQ_ORDER.indexOf(a.frequency), ib = FREQ_ORDER.indexOf(b.frequency)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })

  return successResponse({
    reports,
    summary: { total, byDept, byFreq, deptCount: byDept.length },
    canEdit: requireRoles(user.roleCode, EDIT_ROLES),
  })
}

// POST /api/reports/management — thêm 1 báo cáo vào danh mục
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, EDIT_ROLES)) return errorResponse('Không có quyền sửa danh mục báo cáo', 403)

  const b = await req.json().catch(() => null)
  const department = String(b?.department || '').trim()
  const name = String(b?.name || '').trim()
  if (!department || !name) return errorResponse('Thiếu Phòng / Tên báo cáo', 400)

  const maxOrder = await prisma.managementReport.aggregate({ _max: { sortOrder: true } })
  const created = await prisma.managementReport.create({
    data: {
      sortOrder: (maxOrder._max.sortOrder || 0) + 1,
      department, name,
      owner: str(b?.owner), dataSource: str(b?.dataSource), recipient: str(b?.recipient),
      frequency: str(b?.frequency), note: str(b?.note), autoKey: str(b?.autoKey),
    },
  })
  return successResponse({ report: created }, 'Đã thêm báo cáo', 201)
}

// PATCH /api/reports/management — sửa 1 báo cáo (body.id + các trường)
export async function PATCH(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, EDIT_ROLES)) return errorResponse('Không có quyền sửa danh mục báo cáo', 403)

  const b = await req.json().catch(() => null)
  const id = String(b?.id || '').trim()
  if (!id) return errorResponse('Thiếu id', 400)
  const exists = await prisma.managementReport.findUnique({ where: { id }, select: { id: true } })
  if (!exists) return errorResponse('Không tìm thấy báo cáo', 404)

  const data: Record<string, unknown> = {}
  if (b.department !== undefined) { const v = String(b.department).trim(); if (!v) return errorResponse('Phòng không được rỗng', 400); data.department = v }
  if (b.name !== undefined) { const v = String(b.name).trim(); if (!v) return errorResponse('Tên báo cáo không được rỗng', 400); data.name = v }
  for (const k of ['owner', 'dataSource', 'recipient', 'frequency', 'note', 'autoKey'] as const) if (b[k] !== undefined) data[k] = str(b[k])
  if (b.active !== undefined) data.active = !!b.active
  if (b.sortOrder !== undefined && Number.isFinite(Number(b.sortOrder))) data.sortOrder = Number(b.sortOrder)
  if (Object.keys(data).length === 0) return errorResponse('Không có trường nào để cập nhật', 400)

  const updated = await prisma.managementReport.update({ where: { id }, data })
  return successResponse({ report: updated }, 'Đã cập nhật báo cáo')
}

// DELETE /api/reports/management?id=... — ẩn (active=false) khỏi danh mục
export async function DELETE(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, EDIT_ROLES)) return errorResponse('Không có quyền xóa báo cáo', 403)

  const id = new URL(req.url).searchParams.get('id') || ''
  if (!id) return errorResponse('Thiếu id', 400)
  const exists = await prisma.managementReport.findUnique({ where: { id }, select: { id: true } })
  if (!exists) return errorResponse('Không tìm thấy báo cáo', 404)
  await prisma.managementReport.update({ where: { id }, data: { active: false } })
  return successResponse({ id }, 'Đã xóa báo cáo khỏi danh mục')
}

const str = (v: unknown): string | null => { const s = String(v ?? '').trim(); return s || null }
