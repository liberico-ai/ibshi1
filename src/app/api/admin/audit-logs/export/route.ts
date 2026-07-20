import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, errorResponse, unauthorizedResponse, forbiddenResponse } from '@/lib/auth'
import { deptOfRole, rolesOfDept } from '@/lib/org-map'
import { ROLES } from '@/lib/constants'
import {
  parseLogExportRange, buildLogWorkbookBuffer, deptLabel,
  DEPT_UNKNOWN, EXPORT_MAX_ROWS, type ExportRow,
} from '@/lib/log-export'

const ADMIN_ROLES = ['R01', 'R10']

const HEADERS = ['Thời gian', 'Nhân sự', 'Tài khoản', 'Vai trò', 'Phòng ban', 'Hành động', 'Đối tượng', 'Mô tả', 'Mã đối tượng', 'IP', 'Chi tiết (JSON)']

// Dịch mã hành động → tiếng Việt để cột "Hành động" dễ đọc.
const ACTION_VI: Record<string, string> = {
  CREATE: 'Tạo mới', UPDATE: 'Cập nhật', DELETE: 'Xóa',
  LOGIN: 'Đăng nhập', LOGOUT: 'Đăng xuất',
  COMPLETE: 'Hoàn thành', FINALIZE: 'Chốt', APPROVE: 'Phê duyệt', REJECT: 'Từ chối', RETURN: 'Trả lại',
  APPLY_TEMPLATE: 'Áp quy trình', TRANSITION: 'Chuyển trạng thái',
  CHANGE_PASSWORD: 'Đổi mật khẩu', RESET_PASSWORD: 'Đặt lại mật khẩu', DEACTIVATE: 'Vô hiệu hóa',
  RECEIPT_CREATE: 'Tạo phiếu thu', RECEIPT_DELETE: 'Xóa phiếu thu',
  SETTLEMENT_REFRESH: 'Cập nhật quyết toán', LINK_PO: 'Gắn PO', MRB_RELEASE: 'Phát hành MRB',
}
// Dịch tên "đối tượng" (entity) → tiếng Việt cho biết hành động ở phần nào.
const ENTITY_VI: Record<string, string> = {
  Project: 'Dự án', Task: 'Công việc', Material: 'Vật tư', user: 'Người dùng', User: 'Người dùng',
  WorkOrder: 'Lệnh sản xuất', CustomerReceipt: 'Phiếu thu', ProjectSettlement: 'Quyết toán dự án',
  PermissionMatrix: 'Phân quyền', ProjectDocument: 'Tài liệu dự án', PurchaseContract: 'Hợp đồng mua',
  ProjectBaseline: 'Mốc dự án (baseline)', JobCard: 'Phiếu công việc', MrbRelease: 'Phát hành MRB',
  PurchaseOrder: 'Đơn mua (PO)', PurchaseRequest: 'Đề nghị mua (PR)', Inspection: 'Nghiệm thu',
}

const actionVi = (a: string) => ACTION_VI[a] || a
const entityVi = (e: string) => ENTITY_VI[e] || e

function fmt(d: Date): string {
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false })
}

function pick(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k]
    if (v != null && v !== '') return String(v)
  }
  return ''
}

// Rút mô tả dễ hiểu từ dữ liệu thay đổi: tên/mã/chuyển-trạng-thái, thay cho cuid khó đọc.
function describe(changesRaw: unknown): string {
  let c: Record<string, unknown> | null = null
  try {
    const parsed = typeof changesRaw === 'string' ? JSON.parse(changesRaw) : changesRaw
    if (parsed && typeof parsed === 'object') c = parsed as Record<string, unknown>
  } catch { /* bỏ qua */ }
  if (!c) return ''

  // Một số action lồng { changes: {...} } (vd cập nhật User) → gộp lên
  const nested = c.changes
  const obj = nested && typeof nested === 'object' ? { ...c, ...(nested as Record<string, unknown>) } : c

  const name = pick(obj, ['title', 'projectName', 'name', 'fullName', 'label'])
  const code = pick(obj, ['projectCode', 'contractCode', 'docCode', 'woCode', 'materialCode', 'poCode', 'templateCode'])
  const main = name || code
  const parts: string[] = []
  if (main) parts.push(main)
  if (name && code && code !== name) parts.push(`(${code})`)
  if (obj.from != null || obj.to != null) parts.push(`[${obj.from ?? '?'} → ${obj.to ?? '?'}]`)
  if (!main && obj.amount != null) parts.push(`Số tiền ${obj.amount}`)
  return parts.join(' ')
}

// GET /api/admin/audit-logs/export?from=&to=&dept=&action= — xuất Nhật ký ra Excel (R01/R10)
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!ADMIN_ROLES.includes(payload.roleCode)) return forbiddenResponse()

    const url = new URL(req.url)
    const parsed = parseLogExportRange(url)
    if ('error' in parsed) return errorResponse(parsed.error, 400)
    const { from, to } = parsed.range

    const dept = url.searchParams.get('dept') || 'ALL'
    const action = url.searchParams.get('action') || 'ALL'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { createdAt: { gte: from, lte: to } }
    if (action !== 'ALL') where.action = action
    if (dept !== 'ALL') {
      const roles = rolesOfDept(dept)
      where.user = { roleCode: { in: roles.length ? roles : ['__none__'] } }
    }

    const count = await prisma.auditLog.count({ where })
    if (count > EXPORT_MAX_ROWS) {
      return errorResponse(`Quá nhiều bản ghi (${count}). Vui lòng thu hẹp khoảng thời gian (tối đa ${EXPORT_MAX_ROWS}).`, 400)
    }

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { username: true, fullName: true, roleCode: true, employee: { select: { employeeCode: true } } } } },
    })

    // Tra entityId → tên thật cho Công việc/Dự án (nhiều nhất) → cột "Mô tả" rõ cả khi changes rỗng.
    const taskIds = [...new Set(logs.filter(l => l.entity === 'Task' && l.entityId).map(l => l.entityId as string))]
    const projectIds = [...new Set(logs.filter(l => l.entity === 'Project' && l.entityId).map(l => l.entityId as string))]
    const [tasks, projects] = await Promise.all([
      taskIds.length ? prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, title: true } }) : Promise.resolve([]),
      projectIds.length ? prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, projectCode: true, projectName: true } }) : Promise.resolve([]),
    ])
    const taskName = new Map(tasks.map(t => [t.id, t.title]))
    const projName = new Map(projects.map(p => [p.id, `${p.projectName} (${p.projectCode})`]))
    const resolveName = (entity: string, entityId: string | null): string => {
      if (!entityId) return ''
      if (entity === 'Task') return taskName.get(entityId) || ''
      if (entity === 'Project') return projName.get(entityId) || ''
      return ''
    }

    const rows: ExportRow[] = logs.map(l => {
      const roleCode = l.user?.roleCode || ''
      const deptCode = deptOfRole(roleCode) || DEPT_UNKNOWN
      const username = l.user?.username || ''
      const fullName = l.user?.fullName || ''
      const empCode = l.user?.employee?.employeeCode || username || '?'
      // Định dạng nhân sự: MãNV-Tên (dùng username nếu chưa có mã nhân viên).
      const person = fullName ? `${empCode}-${fullName}` : empCode
      return {
        dept: deptCode,
        group: actionVi(l.action),
        person,
        values: {
          'Thời gian': fmt(l.createdAt),
          'Nhân sự': person,
          'Tài khoản': username,
          'Vai trò': ROLES[roleCode as keyof typeof ROLES]?.name || roleCode,
          'Phòng ban': deptLabel(deptCode),
          'Hành động': actionVi(l.action),
          'Đối tượng': entityVi(l.entity),
          'Mô tả': describe(l.changes) || resolveName(l.entity, l.entityId),
          'Mã đối tượng': l.entityId || '',
          'IP': l.ipAddress || '',
          'Chi tiết (JSON)': l.changes ? JSON.stringify(l.changes) : '',
        },
      }
    })

    const flat = dept !== 'ALL' && action !== 'ALL'
    const buffer = buildLogWorkbookBuffer({ headers: HEADERS, rows, flat, groupColLabel: 'Hành động' })

    const fromName = url.searchParams.get('from')
    const toName = url.searchParams.get('to')
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="nhat-ky_${fromName}_${toName}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('GET /api/admin/audit-logs/export error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
