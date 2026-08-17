import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit } from '@/lib/auth'
import { FAB_WRITE_ROLES, soThuc, docNgay, oRong } from '@/lib/fab-allocation'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
const TRAN_SO_O = 2000 // trần an toàn cho 1 lần lưu

/**
 * POST /api/procurement/fab-allocations/bulk?projectId=...
 * body: { cells: [{ prItemId, fabricationCategoryId, qty, weight, ngayCanTaiCongTruong }] }
 * [PORT Thương Mại] Lưu nhiều ô trong MỘT giao dịch — tất cả hoặc không gì cả (bám saveProjectFabAllocationsBulk).
 * 6 chốt kiểm: (1) đúng dự án (2) hạng mục hợp lệ (3) không trùng ô (4) không âm (5) ngày đọc được (6) không vượt trần reqQty.
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

    const body = await req.json().catch(() => ({})) as { cells?: unknown }
    const cells = Array.isArray(body.cells) ? body.cells as Record<string, unknown>[] : null
    if (!cells) return errorResponse('Thân yêu cầu phải có mảng cells', 400)
    if (cells.length === 0) return errorResponse('Không có ô nào để lưu', 400)
    if (cells.length > TRAN_SO_O) return errorResponse(`Tối đa ${TRAN_SO_O} ô một lần lưu; lần này gửi ${cells.length} ô`, 400)

    // Hạng mục + vật tư PHẢI thuộc đúng dự án — chốt chặn ghi chéo dự án (không tin id trình duyệt).
    const hangMucs = await prisma.fabricationCategory.findMany({ where: { projectId }, select: { id: true } })
    const idHangMuc = new Set(hangMucs.map(h => h.id))
    const idVatTu = [...new Set(cells.map(c => String(c?.prItemId ?? '')).filter(Boolean))]
    const vatTus = await prisma.purchaseRequestItem.findMany({
      where: { id: { in: idVatTu }, purchaseRequest: { projectId } },
      select: { id: true, itemCode: true, unit: true, reqQty: true },
    })
    const theoId = new Map(vatTus.map(d => [d.id, d]))

    // Soát từng ô
    const loi: Array<{ o: number; ly_do: string }> = []
    const oHopLe: Array<{ prItemId: string; fabricationCategoryId: string; qty: number; weight: number; ngay: Date | null }> = []
    const daThay = new Set<string>()
    cells.forEach((c, i) => {
      const prItemId = String(c?.prItemId ?? '')
      const fabricationCategoryId = String(c?.fabricationCategoryId ?? '')
      const o = i + 1
      if (!theoId.has(prItemId)) { loi.push({ o, ly_do: 'vật tư không có hoặc không thuộc dự án này' }); return }
      if (!idHangMuc.has(fabricationCategoryId)) { loi.push({ o, ly_do: 'hạng mục không có hoặc không thuộc dự án này' }); return }
      const khoa = `${prItemId}|${fabricationCategoryId}`
      if (daThay.has(khoa)) { loi.push({ o, ly_do: 'ô này bị gửi trùng hai lần' }); return }
      daThay.add(khoa)
      const ngay = docNgay(c?.ngayCanTaiCongTruong)
      if (ngay === undefined) { loi.push({ o, ly_do: `ngày cần tại công trường không đọc được: "${c?.ngayCanTaiCongTruong}"` }); return }
      const qty = soThuc(c?.qty), weight = soThuc(c?.weight)
      if (qty < 0 || weight < 0) { loi.push({ o, ly_do: 'số lượng và khối lượng không được âm' }); return }
      oHopLe.push({ prItemId, fabricationCategoryId, qty, weight, ngay })
    })
    if (loi.length > 0) return errorResponse(`${loi.length} ô không hợp lệ — chưa ghi gì cả: ${loi.slice(0, 5).map(l => `ô ${l.o} — ${l.ly_do}`).join('; ')}`, 400)

    // Kiểm trần: gộp ô mới với ô cũ KHÔNG bị lần này ghi đè, rồi so reqQty theo từng vật tư.
    const daCo = await prisma.purchaseRequestItemFabAllocation.findMany({
      where: { prItemId: { in: idVatTu } },
      select: { prItemId: true, fabricationCategoryId: true, qty: true },
    })
    const biGhiDe = new Set(oHopLe.map(o => `${o.prItemId}|${o.fabricationCategoryId}`))
    const tongTheoVatTu = new Map<string, number>()
    const cong = (id: string, v: number) => tongTheoVatTu.set(id, (tongTheoVatTu.get(id) ?? 0) + v)
    for (const a of daCo) if (!biGhiDe.has(`${a.prItemId}|${a.fabricationCategoryId}`)) cong(a.prItemId, Number(a.qty))
    for (const o of oHopLe) cong(o.prItemId, o.qty)

    const vuot: Array<{ itemCode: string | null; tongPhanBo: number; reqQty: number; vuot: number }> = []
    const canhBao: Array<{ itemCode: string | null; ly_do: string }> = []
    for (const [id, tong] of tongTheoVatTu) {
      const d = theoId.get(id); if (!d) continue
      const reqQty = Number(d.reqQty ?? 0)
      if (reqQty > 0) {
        if (tong > reqQty + 0.001) vuot.push({ itemCode: d.itemCode, tongPhanBo: Number(tong.toFixed(3)), reqQty, vuot: Number((tong - reqQty).toFixed(3)) })
      } else if (tong > 0) {
        // Không chặn: vật tư reqQty=0 chưa có trần để đối chiếu. Chặn thì không nhập được; im lặng thì giấu.
        canhBao.push({ itemCode: d.itemCode, ly_do: 'vật tư chưa có số lượng yêu cầu mua nên không đối chiếu được trần' })
      }
    }
    if (vuot.length > 0) return errorResponse(`${vuot.length} vật tư có tổng phân bổ vượt SL yêu cầu mua — chưa ghi gì cả: ${vuot.slice(0, 5).map(v => `${v.itemCode} (${v.tongPhanBo}>${v.reqQty})`).join('; ')}`, 400)

    // Ghi: một giao dịch, tất cả hoặc không gì cả.
    const dsXoa = oHopLe.filter(o => oRong(o.qty, o.weight, o.ngay))
    const dsGhi = oHopLe.filter(o => !oRong(o.qty, o.weight, o.ngay))
    const viec: Prisma.PrismaPromise<unknown>[] = []
    if (dsXoa.length > 0) {
      viec.push(prisma.purchaseRequestItemFabAllocation.deleteMany({
        where: { OR: dsXoa.map(o => ({ prItemId: o.prItemId, fabricationCategoryId: o.fabricationCategoryId })) },
      }))
    }
    for (const o of dsGhi) {
      viec.push(prisma.purchaseRequestItemFabAllocation.upsert({
        where: { prItemId_fabricationCategoryId: { prItemId: o.prItemId, fabricationCategoryId: o.fabricationCategoryId } },
        update: { qty: o.qty, weight: o.weight, ngayCanTaiCongTruong: o.ngay },
        create: { prItemId: o.prItemId, fabricationCategoryId: o.fabricationCategoryId, qty: o.qty, weight: o.weight, ngayCanTaiCongTruong: o.ngay },
      }))
    }
    const ketQua = await prisma.$transaction(viec)
    const soOXoa = dsXoa.length > 0 ? ((ketQua[0] as { count?: number })?.count ?? 0) : 0
    await logAudit(payload.userId, 'UPDATE_FAB_ALLOCATION_BULK', 'Project', projectId, { duAn: duAn.projectCode, soOGhi: dsGhi.length, soOXoa, soVatTu: tongTheoVatTu.size })

    return successResponse({ soOGhi: dsGhi.length, soOXoa, soVatTu: tongTheoVatTu.size, canhBao }, `Đã lưu ${dsGhi.length} ô, xóa ${soOXoa} ô trống${canhBao.length ? ` (${canhBao.length} cảnh báo)` : ''}`)
  } catch (err) {
    console.error('POST fab-allocations bulk error:', err)
    return errorResponse('Lỗi lưu lưới phân bổ', 500)
  }
}
