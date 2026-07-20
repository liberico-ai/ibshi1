import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, errorResponse, unauthorizedResponse, forbiddenResponse } from '@/lib/auth'
import { deptOfRole, rolesOfDept } from '@/lib/org-map'
import {
  parseLogExportRange, buildLogWorkbookBuffer, deptLabel,
  DEPT_UNKNOWN, EXPORT_MAX_ROWS, type ExportRow,
} from '@/lib/log-export'

const ADMIN_ROLES = ['R01', 'R10']

const HEADERS = ['Thời gian', 'Mức', 'Mã lỗi', 'Thông điệp', 'Đường dẫn', 'Method', 'HTTP', 'Nguồn', 'Đã xử lý', 'Tài khoản (ID)', 'Role', 'Phòng ban', 'IP']

function fmt(d: Date): string {
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false })
}

// GET /api/admin/error-logs/export?from=&to=&dept=&level= — xuất Error Logs ra Excel (R01/R10)
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
    const level = url.searchParams.get('level') || 'ALL'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { createdAt: { gte: from, lte: to } }
    if (level !== 'ALL') where.level = level
    if (dept !== 'ALL') {
      const roles = rolesOfDept(dept)
      where.userRole = { in: roles.length ? roles : ['__none__'] }
    }

    const count = await prisma.errorLog.count({ where })
    if (count > EXPORT_MAX_ROWS) {
      return errorResponse(`Quá nhiều bản ghi (${count}). Vui lòng thu hẹp khoảng thời gian (tối đa ${EXPORT_MAX_ROWS}).`, 400)
    }

    const logs = await prisma.errorLog.findMany({ where, orderBy: { createdAt: 'desc' } })

    const rows: ExportRow[] = logs.map(l => {
      const deptCode = deptOfRole(l.userRole) || DEPT_UNKNOWN
      return {
        dept: deptCode,
        group: l.level,
        values: {
          'Thời gian': fmt(l.createdAt),
          'Mức': l.level,
          'Mã lỗi': l.code || '',
          'Thông điệp': l.message,
          'Đường dẫn': l.path || '',
          'Method': l.method || '',
          'HTTP': l.statusCode ?? '',
          'Nguồn': l.source,
          'Đã xử lý': l.resolved ? 'Rồi' : 'Chưa',
          'Tài khoản (ID)': l.userId || '',
          'Role': l.userRole || '',
          'Phòng ban': deptLabel(deptCode),
          'IP': l.ipAddress || '',
        },
      }
    })

    const flat = dept !== 'ALL' && level !== 'ALL'
    const buffer = buildLogWorkbookBuffer({ headers: HEADERS, rows, flat, groupColLabel: 'Mức' })

    const fromName = url.searchParams.get('from')
    const toName = url.searchParams.get('to')
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="error-logs_${fromName}_${toName}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('GET /api/admin/error-logs/export error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
