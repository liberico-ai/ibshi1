import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { describeDbError } from '@/lib/db-missing-table'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { can } from '@/lib/permissions/can'

export const dynamic = 'force-dynamic'

// Đẩy dòng theo LÔ. Body của route handler bị chặn ở 10MB nên không gửi 25.000 dòng một lần
// được; client chia lô ~2.500 dòng (~1,5MB/lô) và gọi nhiều lần.
const MAX_BATCH = 5000

// 25.000 dòng thì không trả một lần được — luôn phân trang, mặc định 100 dòng/trang.
const MAX_LIMIT = 500

// GET /api/design/apl/[id]/lines?page=&limit=&q=&assembly=&grade=&profile=&type=all|part|assembly
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const { id } = await params

    const exists = await prisma.aplImport.findUnique({ where: { id }, select: { id: true } })
    if (!exists) return errorResponse('Không tìm thấy bản APL này', 404)

    const sp = req.nextUrl.searchParams
    const page = Math.max(1, Number(sp.get('page') || 1))
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(sp.get('limit') || 100)))
    const q = (sp.get('q') || '').trim()
    const item = sp.get('item')
    const assembly = (sp.get('assembly') || '').trim()
    const grade = (sp.get('grade') || '').trim()
    const profile = (sp.get('profile') || '').trim()
    const type = sp.get('type') || 'all'

    const where: Prisma.AplLineWhereInput = { importId: id }
    if (type === 'part') where.isAssembly = false
    else if (type === 'assembly') where.isAssembly = true
    // item="" là một GIÁ TRỊ hợp lệ (dòng không có ITEM), khác hẳn "không lọc theo item"
    if (item !== null) where.item = item === '' ? null : item
    if (assembly) where.assembly = assembly
    if (grade) where.grade = grade
    if (profile) where.profile = profile
    if (q) {
      where.OR = [
        { part: { contains: q, mode: 'insensitive' } },
        { markCutting: { contains: q, mode: 'insensitive' } },
        { assembly: { contains: q, mode: 'insensitive' } },
        { drawingNo: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { profile: { contains: q, mode: 'insensitive' } },
      ]
    }

    const [total, lines, agg] = await Promise.all([
      prisma.aplLine.count({ where }),
      prisma.aplLine.findMany({ where, orderBy: { rowNo: 'asc' }, skip: (page - 1) * limit, take: limit }),
      prisma.aplLine.aggregate({ where, _sum: { totalWeightKg: true, areaM2: true } }),
    ])

    return successResponse({
      lines,
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
      // Tổng của ĐÚNG bộ lọc đang xem — không phải tổng cả bảng
      filteredWeightKg: agg._sum.totalWeightKg || 0,
      filteredAreaM2: agg._sum.areaM2 || 0,
    })
  } catch (err) {
    console.error('GET /api/design/apl/[id]/lines error:', err)
    return errorResponse(describeDbError(err, 'Lỗi khi đọc APL'), 500)
  }
}

interface InLine {
  rowNo?: number; isAssembly?: boolean
  seq?: string | null; drawingNo?: string | null; assembly?: string | null; pos?: string | null
  part?: string | null; markCutting?: string | null; item?: string | null; description?: string | null
  profile?: string | null; grade?: string | null; typeCutting?: string | null
  thicknessMm?: number | null; widthMm?: number | null; lengthMm?: number | null
  qty?: number | null; unitWeightKg?: number | null; totalWeightKg?: number | null; areaM2?: number | null
  category?: string | null; remark?: string | null
  blockNo?: number; rollupWeightKg?: number | null; rollupMaterials?: string[] | null; childCount?: number
  extra?: Record<string, string | number>
}

const txt = (v: unknown): string | null => {
  if (v == null) return null
  const s = String(v).trim()
  return s ? s.slice(0, 500) : null
}
const flt = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// POST /api/design/apl/[id]/lines — nạp một lô dòng vào phiếu đã tạo
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!(await can(user, 'form.APL'))) return errorResponse('Bạn không có quyền nhập APL', 403)
    const { id } = await params

    const imp = await prisma.aplImport.findUnique({ where: { id }, select: { id: true, importedBy: true } })
    if (!imp) return errorResponse('Không tìm thấy phiếu APL này', 404)
    // Chỉ người đang nạp dở phiếu đó mới được đẩy tiếp — tránh hai phiên trộn dòng vào nhau.
    if (imp.importedBy !== user.userId) return errorResponse('Phiếu APL này do người khác nhập', 403)

    const body = await req.json().catch(() => null) as { lines?: InLine[] } | null
    const lines = Array.isArray(body?.lines) ? body!.lines : null
    if (!lines) return errorResponse('Thiếu danh sách dòng')
    if (lines.length === 0) return successResponse({ inserted: 0 })
    if (lines.length > MAX_BATCH) return errorResponse(`Mỗi lô tối đa ${MAX_BATCH} dòng`)

    const data = lines.map((l, i) => ({
      importId: id,
      rowNo: Number.isFinite(Number(l.rowNo)) ? Math.trunc(Number(l.rowNo)) : i,
      isAssembly: !!l.isAssembly,
      seq: txt(l.seq), drawingNo: txt(l.drawingNo), assembly: txt(l.assembly), pos: txt(l.pos),
      part: txt(l.part), markCutting: txt(l.markCutting), item: txt(l.item), description: txt(l.description),
      profile: txt(l.profile), grade: txt(l.grade), typeCutting: txt(l.typeCutting),
      thicknessMm: flt(l.thicknessMm), widthMm: flt(l.widthMm), lengthMm: flt(l.lengthMm),
      qty: flt(l.qty), unitWeightKg: flt(l.unitWeightKg), totalWeightKg: flt(l.totalWeightKg), areaM2: flt(l.areaM2),
      category: txt(l.category), remark: txt(l.remark),
      blockNo: Number.isFinite(Number(l.blockNo)) ? Math.trunc(Number(l.blockNo)) : 0,
      rollupWeightKg: flt(l.rollupWeightKg),
      rollupMaterials: Array.isArray(l.rollupMaterials) && l.rollupMaterials.length
        ? (l.rollupMaterials.map(m => String(m).slice(0, 120)).slice(0, 60) as unknown as Prisma.InputJsonValue)
        : undefined,
      childCount: Number.isFinite(Number(l.childCount)) ? Math.trunc(Number(l.childCount)) : 0,
      extra: l.extra && typeof l.extra === 'object' && Object.keys(l.extra).length
        ? (l.extra as unknown as Prisma.InputJsonValue)
        : undefined,
    }))

    await prisma.aplLine.createMany({ data })
    const inserted = await prisma.aplLine.count({ where: { importId: id } })
    return successResponse({ inserted: data.length, totalSoFar: inserted })
  } catch (err) {
    console.error('POST /api/design/apl/[id]/lines error:', err)
    return errorResponse(describeDbError(err, 'Lỗi khi nạp dòng APL'), 500)
  }
}
