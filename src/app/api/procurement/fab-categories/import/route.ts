import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit } from '@/lib/auth'
import { FAB_WRITE_ROLES, chuanHoaHangMuc } from '@/lib/fab-allocation'

export const dynamic = 'force-dynamic'

/**
 * POST /api/procurement/fab-categories/import?projectId=...  body: { rows: [{ code, name, sortOrder?, ghiChu? }] }
 * [PORT Thương Mại] Nhập hàng loạt (bám importFabCategories). Trùng mã trong dự án → CẬP NHẬT (upsert).
 * Tối đa 500 dòng; báo lỗi theo số dòng Excel; trùng mã trong chính file → bỏ dòng đó.
 */
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!FAB_WRITE_ROLES.includes(payload.roleCode)) return errorResponse('Không có quyền', 403)
    const projectId = req.nextUrl.searchParams.get('projectId')
    if (!projectId) return errorResponse('Thiếu projectId', 400)

    const duAn = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, projectCode: true } })
    if (!duAn) return errorResponse('Không tìm thấy dự án', 404)

    const body = await req.json().catch(() => ({})) as { rows?: unknown }
    const rows = Array.isArray(body.rows) ? body.rows as Record<string, unknown>[] : null
    if (!rows || rows.length === 0) return errorResponse('Không có dòng nào để nhập', 400)
    if (rows.length > 500) return errorResponse('Tối đa 500 dòng một lần nhập', 400)

    const hopLe: ReturnType<typeof chuanHoaHangMuc>[] = []
    const loi: Array<{ dong: number; ly_do: string }> = []
    const daThay = new Set<string>()
    rows.forEach((r, i) => {
      const hm = chuanHoaHangMuc(r, i)
      const dong = i + 2 // dòng 1 là tiêu đề Excel
      if (!hm.code) { loi.push({ dong, ly_do: 'thiếu mã hạng mục' }); return }
      if (!hm.name) { loi.push({ dong, ly_do: `mã "${hm.code}" thiếu tên hạng mục` }); return }
      if (daThay.has(hm.code)) { loi.push({ dong, ly_do: `mã "${hm.code}" bị lặp trong chính file` }); return }
      daThay.add(hm.code)
      hopLe.push(hm)
    })

    if (hopLe.length === 0) return errorResponse(`Không dòng nào hợp lệ (${loi.length} lỗi): ${loi.slice(0, 5).map(l => `dòng ${l.dong} — ${l.ly_do}`).join('; ')}`, 400)

    const ketQua = await prisma.$transaction(
      hopLe.map(hm => prisma.fabricationCategory.upsert({
        where: { projectId_code: { projectId, code: hm.code } },
        update: { name: hm.name, sortOrder: hm.sortOrder, ghiChu: hm.ghiChu },
        create: { projectId, ...hm },
      })),
    )
    await logAudit(payload.userId, 'IMPORT_FAB_CATEGORIES', 'Project', projectId, { soDongNhap: ketQua.length, soDongBoQua: loi.length })

    return successResponse(
      { duAn: duAn.projectCode, soDongNhan: rows.length, soDongNhap: ketQua.length, soDongBoQua: loi.length, loi },
      `Đã nhập ${ketQua.length} hạng mục${loi.length ? `, bỏ qua ${loi.length} dòng lỗi` : ''}`,
    )
  } catch (err) {
    console.error('POST fab-categories import error:', err)
    return errorResponse('Lỗi nhập hạng mục', 500)
  }
}
