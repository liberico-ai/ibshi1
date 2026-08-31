import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { can } from '@/lib/permissions/can'
import { describeDbError } from '@/lib/db-missing-table'

export const dynamic = 'force-dynamic'

// VÌ SAO KHÔNG NHẬN THẲNG FILE EXCEL Ở ĐÂY:
// Route handler của Next chặn body > 10MB (đo thực tế: 9,9MB qua — 11,1MB "Failed to parse body
// as FormData"; serverActions.bodySizeLimit KHÔNG áp cho route handler). File APL thật 12,98MB,
// tách riêng sheet APL vẫn còn 10,52MB → đằng nào cũng vượt.
// Nên: CLIENT đọc Excel, chỉ lấy đúng sheet APL, parse bằng apl-parser (hàm thuần, dùng chung),
// rồi gọi 2 bước — tạo phiếu ở đây, đẩy dòng theo lô qua /[id]/lines.

// GET /api/design/apl?taskId=&projectId=  — danh sách lần nhập (không kèm dòng)
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const sp = req.nextUrl.searchParams
    const taskId = sp.get('taskId') || undefined
    const projectId = sp.get('projectId') || undefined
    if (!taskId && !projectId) return errorResponse('Cần taskId hoặc projectId')

    const imports = await prisma.aplImport.findMany({
      where: { ...(taskId ? { taskId } : {}), ...(projectId ? { projectId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true, fileName: true, sheetName: true, title: true, revision: true,
        totalRows: true, assemblyRows: true, partRows: true, distinctAssemblies: true,
        scopeUnits: true, totalWeightKg: true, totalAreaM2: true, byCategory: true,
        warnings: true, importedBy: true, createdAt: true,
      },
    })
    return successResponse({ imports })
  } catch (err) {
    console.error('GET /api/design/apl error:', err)
    return errorResponse(describeDbError(err, 'Lỗi khi đọc danh sách APL'), 500)
  }
}

interface CreateBody {
  taskId?: string
  projectId?: string
  fileName?: string
  sheetName?: string
  title?: string
  revision?: string
  headerRow?: number
  columns?: unknown[]
  summary?: {
    totalRows?: number; assemblyRows?: number; partRows?: number
    distinctAssemblies?: number; scopeUnits?: number
    totalWeightKg?: number; totalAreaM2?: number
    byCategory?: Record<string, number>
  }
  warnings?: string[]
}

const int = (v: unknown, d = 0) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= 0 ? n : d }
const num = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }

// POST /api/design/apl — tạo phiếu nhập (chưa có dòng). Dòng đẩy sau qua /[id]/lines.
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!(await can(user, 'form.APL'))) return errorResponse('Bạn không có quyền nhập APL', 403)

    const body = await req.json().catch(() => null) as CreateBody | null
    if (!body) return errorResponse('Dữ liệu gửi lên không hợp lệ')
    if (!body.sheetName) return errorResponse('Thiếu tên sheet APL')
    if (!Array.isArray(body.columns) || body.columns.length === 0) return errorResponse('Thiếu mô hình cột')

    const s = body.summary || {}
    const created = await prisma.aplImport.create({
      data: {
        projectId: body.projectId?.trim() || null,
        taskId: body.taskId?.trim() || null,
        fileName: String(body.fileName || 'APL.xlsx').slice(0, 250),
        sheetName: String(body.sheetName).slice(0, 250),
        title: body.title ? String(body.title).slice(0, 250) : null,
        revision: body.revision ? String(body.revision).slice(0, 30) : null,
        headerRow: int(body.headerRow),
        columns: body.columns as unknown as Prisma.InputJsonValue,
        totalRows: int(s.totalRows),
        assemblyRows: int(s.assemblyRows),
        partRows: int(s.partRows),
        distinctAssemblies: int(s.distinctAssemblies),
        scopeUnits: int(s.scopeUnits, 1) || 1,
        totalWeightKg: num(s.totalWeightKg),
        totalAreaM2: num(s.totalAreaM2),
        byCategory: (s.byCategory || {}) as unknown as Prisma.InputJsonValue,
        warnings: (Array.isArray(body.warnings) ? body.warnings : []) as unknown as Prisma.InputJsonValue,
        importedBy: user.userId,
      },
      select: { id: true },
    })

    await logAudit(user.userId, 'IMPORT_APL', 'AplImport', created.id,
      { fileName: body.fileName, sheet: body.sheetName, rows: s.totalRows, projectId: body.projectId, taskId: body.taskId },
      getClientIP(req))

    return successResponse({ importId: created.id }, 'Đã tạo phiếu APL, đang đẩy dòng…', 201)
  } catch (err) {
    console.error('POST /api/design/apl error:', err)
    return errorResponse(describeDbError(err, 'Lỗi khi tạo phiếu APL'), 500)
  }
}
