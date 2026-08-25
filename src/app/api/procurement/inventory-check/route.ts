import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { Prisma } from '@prisma/client'
import { buildMaterialIndex, matchByAttributes, type MatStock } from '@/lib/material-match'

export const dynamic = 'force-dynamic'
const N = (v: unknown) => Number(v ?? 0)
const CAN_WRITE = ['R01', 'R02', 'R03', 'R03a', 'R05', 'R05a', 'R07', 'R07a', 'R10']

/**
 * GET /api/procurement/inventory-check?prId=<id>
 * [PORT Thương Mại — F1] Kiểm tra tồn kho trước RFQ: đối chiếu từng dòng vật tư PR với tồn kho (Material).
 * available = currentStock − reservedStock. Trạng thái: HAS_STOCK | PARTIAL | NO_STOCK. Gợi ý dùng từ kho = min(available, reqQty).
 * Match tồn: qua materialId, hoặc itemCode ↔ Material.materialCode.
 */
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const prId = req.nextUrl.searchParams.get('prId')
    if (!prId) return errorResponse('Thiếu prId', 400)

    const pr = await prisma.purchaseRequest.findUnique({ where: { id: prId }, select: { prCode: true, status: true } })
    if (!pr) return errorResponse('Không tìm thấy PR', 404)

    const items = await prisma.purchaseRequestItem.findMany({
      where: { prId },
      orderBy: { itemCode: 'asc' },
      select: {
        id: true, itemCode: true, description: true, profile: true, grade: true, unit: true,
        reqQty: true, remainQty: true, toBuyQty: true, materialGroupCode: true, materialId: true,
        material: { select: { id: true, currentStock: true, reservedStock: true, materialCode: true } },
        hardPegging: { select: { quantity: true, status: true } },
      },
    })

    // Vật tư chưa link materialId → thử khớp itemCode ↔ materialCode
    const codes = [...new Set(items.filter(i => !i.material && i.itemCode).map(i => i.itemCode!))]
    const byCode = new Map<string, { id: string; currentStock: unknown; reservedStock: unknown }>()
    if (codes.length) {
      const mats = await prisma.material.findMany({ where: { materialCode: { in: codes } }, select: { id: true, materialCode: true, currentStock: true, reservedStock: true } })
      mats.forEach(m => byCode.set(m.materialCode, m))
    }

    // Cầu nối THUỘC TÍNH: mã PR (theo dự án) ≠ mã kho → khớp theo tên + mác + độ dày/quy cách.
    // Chỉ xây index khi còn dòng chưa khớp được bằng materialId/itemCode.
    const needAttr = items.some(i => !i.material && (!i.itemCode || !byCode.has(i.itemCode)))
    let attrIdx: Map<string, MatStock[]> | null = null
    if (needAttr) {
      const allMats = await prisma.material.findMany({ select: { materialCode: true, name: true, specification: true, grade: true, unit: true, currentStock: true, reservedStock: true } })
      const stocks: MatStock[] = allMats.map(m => ({ materialCode: m.materialCode, name: m.name, specification: m.specification, grade: m.grade, unit: m.unit, available: Math.max(0, N(m.currentStock) - N(m.reservedStock)) }))
      attrIdx = buildMaterialIndex(stocks)
    }

    const rows = items.map(d => {
      const direct = d.material || (d.itemCode ? byCode.get(d.itemCode) : undefined)
      let available = 0
      let inventory: { currentStock: number; reservedStock: number; availableQty: number; matchedBy: string; matchedCodes?: string[] } | null = null
      if (direct) {
        available = Math.max(0, N(direct.currentStock) - N(direct.reservedStock))
        inventory = { currentStock: N(direct.currentStock), reservedStock: N(direct.reservedStock), availableQty: available, matchedBy: d.material ? 'materialId' : 'itemCode' }
      } else if (attrIdx) {
        const am = matchByAttributes({ description: d.description, profile: d.profile, grade: d.grade }, attrIdx)
        if (am) {
          available = am.available
          inventory = { currentStock: available, reservedStock: 0, availableQty: available, matchedBy: 'attributes', matchedCodes: am.materials.slice(0, 5).map(m => m.materialCode) }
        }
      }
      const reqQty = N(d.reqQty)
      const stockStatus = !inventory || available <= 0 ? 'NO_STOCK' : (available >= reqQty ? 'HAS_STOCK' : 'PARTIAL')
      // Giữ tồn: chỉ cho phép khi có mã kho xác định (materialId hoặc itemCode→1 mã). Match thuộc tính không đủ chắc.
      const pegMaterialId = d.materialId || (d.itemCode ? byCode.get(d.itemCode)?.id ?? null : null)
      const peggedQty = d.hardPegging && d.hardPegging.status === 'ACTIVE' ? N(d.hardPegging.quantity) : 0
      return {
        prDetailId: d.id, itemCode: d.itemCode || '', itemName: d.description || '', profile: d.profile || '', grade: d.grade || '', uom: d.unit || '',
        reqQty, remainQty: N(d.remainQty), toBuyQty: N(d.toBuyQty), materialGroupCode: d.materialGroupCode || '',
        inventory,
        stockStatus, suggestedUseFromStock: Math.min(available, reqQty),
        pegMaterialId, peggedQty,
      }
    })

    const cnt = (s: string) => rows.filter(r => r.stockStatus === s).length
    const matchedByAttr = rows.filter(r => r.inventory?.matchedBy === 'attributes').length
    return successResponse({ prId, prCode: pr.prCode, prStatus: pr.status, summary: { total: rows.length, hasStock: cnt('HAS_STOCK'), partial: cnt('PARTIAL'), noStock: cnt('NO_STOCK'), matchedByAttr }, rows })
  } catch (err) {
    console.error('GET inventory-check error:', err)
    return errorResponse('Lỗi kiểm tra tồn kho', 500)
  }
}

/**
 * PATCH /api/procurement/inventory-check  body: { updates: [{ prDetailId, remainQty }] }
 * [PORT Thương Mại — F1] Cập nhật hàng loạt "còn tồn" (remainQty) → tự tính lại "cần mua" (toBuyQty = max(0, reqQty − remain)).
 */
export async function PATCH(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!CAN_WRITE.includes(payload.roleCode)) return errorResponse('Không có quyền cập nhật tồn kho', 403)

    const body = await req.json().catch(() => ({})) as { updates?: Array<{ prDetailId?: string; remainQty?: number | string }> }
    const updates = Array.isArray(body.updates) ? body.updates : null
    if (!updates || updates.length === 0) return errorResponse('Thiếu mảng updates', 400)
    if (updates.length > 2000) return errorResponse('Tối đa 2000 dòng mỗi lần', 400)

    const ids = [...new Set(updates.map(u => String(u.prDetailId || '')).filter(Boolean))]
    const items = await prisma.purchaseRequestItem.findMany({ where: { id: { in: ids } }, select: { id: true, reqQty: true } })
    const reqById = new Map(items.map(i => [i.id, N(i.reqQty)]))

    const ops: Prisma.PrismaPromise<unknown>[] = []
    const results: Array<{ prDetailId: string; remainQty: number; toBuyQty: number }> = []
    for (const u of updates) {
      const id = String(u.prDetailId || '')
      if (!id || !reqById.has(id)) continue
      const remain = Math.max(0, N(u.remainQty))
      const toBuy = Math.max(0, reqById.get(id)! - remain)
      ops.push(prisma.purchaseRequestItem.update({ where: { id }, data: { remainQty: remain, toBuyQty: toBuy } }))
      results.push({ prDetailId: id, remainQty: remain, toBuyQty: toBuy })
    }
    if (ops.length === 0) return errorResponse('Không có dòng hợp lệ để cập nhật', 400)
    await prisma.$transaction(ops)

    return successResponse({ updated: results.length, results }, `Đã cập nhật tồn cho ${results.length} dòng`)
  } catch (err) {
    console.error('PATCH inventory-check error:', err)
    return errorResponse('Lỗi cập nhật tồn kho', 500)
  }
}
