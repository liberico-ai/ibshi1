import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const num = (v: unknown) => Number(v ?? 0)

/**
 * GET /api/procurement/fab-allocations?projectId=...
 * [PORT Thương Mại] Toàn bộ dữ liệu dựng lưới phân bổ chế tạo (bám getProjectFabAllocations).
 * Dòng = vật tư PR (PurchaseRequestItem), cột = hạng mục chế tạo của DỰ ÁN, ô = SL·KL·ngày cần tại CT.
 * Lưu ý ibshi1: chưa có nguồn "ngày hàng thực về" (arrivedDate) → tạm bỏ tiến độ ngày-về.
 */
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const projectId = req.nextUrl.searchParams.get('projectId')
    if (!projectId) return errorResponse('Thiếu projectId', 400)

    const duAn = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, projectCode: true, projectName: true } })
    if (!duAn) return errorResponse('Không tìm thấy dự án', 404)

    const hangMucs = await prisma.fabricationCategory.findMany({
      where: { projectId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, code: true, name: true, sortOrder: true },
    })
    const hangMucSong = new Set(hangMucs.map(h => h.id))

    const chiTiets = await prisma.purchaseRequestItem.findMany({
      where: { purchaseRequest: { projectId } },
      select: {
        id: true, itemCode: true, description: true, profile: true, grade: true, unit: true,
        reqQty: true, reqWeight: true, toBuyQty: true, requiredDate: true,
        purchaseRequest: { select: { id: true, prCode: true } },
        fabAllocations: { select: { fabricationCategoryId: true, qty: true, weight: true, ngayCanTaiCongTruong: true } },
        // Ngày hàng thực về = từ HĐ (PurchaseContractItem → contract.arrivedDate) để đo tiến độ.
        contractItems: { select: { contract: { select: { arrivedDate: true, contractCode: true } } } },
      },
      orderBy: [{ purchaseRequest: { prCode: 'asc' } }, { itemCode: 'asc' }],
    })

    const items = chiTiets.map(d => {
      const o: Record<string, { qty: number; weight: number; ngayCan: Date | null }> = {}
      let tongQty = 0, tongWeight = 0
      let ngayCanSomNhat: Date | null = null
      for (const a of d.fabAllocations) {
        if (!hangMucSong.has(a.fabricationCategoryId)) continue // bỏ ô mồ côi (hạng mục đã xóa)
        const q = num(a.qty), w = num(a.weight)
        o[a.fabricationCategoryId] = { qty: q, weight: w, ngayCan: a.ngayCanTaiCongTruong }
        tongQty += q; tongWeight += w
        if (a.ngayCanTaiCongTruong && (!ngayCanSomNhat || a.ngayCanTaiCongTruong < ngayCanSomNhat)) ngayCanSomNhat = a.ngayCanTaiCongTruong
      }
      const reqQty = num(d.reqQty)
      // Hàng về: HĐ có arrivedDate; "về đủ" khi mọi dòng HĐ đã có ngày về. ngayHangVe = mốc muộn nhất.
      const cis = d.contractItems || []
      const arrived = cis.map(c => c.contract.arrivedDate).filter((x): x is Date => !!x)
      const ngayHangVe = arrived.length ? arrived.reduce((m, x) => (x > m ? x : m)) : null
      return {
        prItemId: d.id,
        soDongHD: cis.length,
        soDongDaVe: arrived.length,
        ngayHangVe: cis.length > 0 && arrived.length === cis.length ? ngayHangVe : (arrived.length ? ngayHangVe : null),
        prId: d.purchaseRequest?.id ?? null,
        prCode: d.purchaseRequest?.prCode ?? null,
        itemCode: d.itemCode,
        itemName: d.description,
        profile: d.profile,
        grade: d.grade,
        uom: d.unit,
        reqQty,
        reqWeight: num(d.reqWeight),
        toBuyQty: num(d.toBuyQty),
        requiredDate: d.requiredDate,
        tongQty,
        tongWeight,
        conLai: reqQty - tongQty,
        // reqQty = 0 nghĩa là chưa có trần để đối chiếu, không phải "vượt trần".
        vuotTran: reqQty > 0 && tongQty > reqQty + 0.001,
        khongCoTran: reqQty <= 0,
        ngayCanSomNhat,
        o,
      }
    })

    const soODaPhanBo = items.reduce((s, i) => s + Object.keys(i.o).length, 0)
    return successResponse({ duAn, hangMucs, soVatTu: items.length, soHangMuc: hangMucs.length, soODaPhanBo, items })
  } catch (err) {
    console.error('GET fab-allocations error:', err)
    return errorResponse('Lỗi tải lưới phân bổ', 500)
  }
}
