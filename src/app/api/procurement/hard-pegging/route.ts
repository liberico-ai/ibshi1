import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles, logAudit, getClientIP } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const N = (v: unknown) => Number(v ?? 0)
// Kho + Thương mại + KTKH + PM/BGĐ/Admin được giữ tồn.
const CAN = ['R01', 'R02', 'R03', 'R03a', 'R05', 'R05a', 'R07', 'R07a', 'R10']

/**
 * Hard Pegging (PORT Thương Mại — Gate 3 allocateStock): giữ CỨNG tồn kho cho nhu cầu 1 dòng PR.
 * Giữ = tăng Material.reservedStock; tồn khả dụng của mã = currentStock − reservedStock.
 * Chống tranh chấp tồn giữa các PR/dự án: không cho giữ vượt tồn khả dụng.
 *
 * GET    ?projectId= | ?prItemId=  — danh sách pegging ACTIVE.
 * POST   { prItemId, quantity? }   — giữ tới mức quantity (mặc định = min(khả dụng, cần)).
 * DELETE ?prItemId=                — nhả toàn bộ (hoàn reserved).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const sp = req.nextUrl.searchParams
    const projectId = sp.get('projectId') || undefined
    const prItemId = sp.get('prItemId') || undefined
    const peggings = await prisma.hardPegging.findMany({
      where: { status: 'ACTIVE', ...(projectId ? { projectId } : {}), ...(prItemId ? { prItemId } : {}) },
      orderBy: { allocatedAt: 'desc' },
      select: {
        id: true, prItemId: true, materialId: true, projectId: true, quantity: true, allocatedBy: true, allocatedAt: true, note: true,
        material: { select: { materialCode: true, name: true, currentStock: true, reservedStock: true } },
        prItem: { select: { itemCode: true, description: true, reqQty: true } },
      },
    })
    return successResponse({
      peggings: peggings.map(p => ({
        id: p.id, prItemId: p.prItemId, materialId: p.materialId, projectId: p.projectId,
        quantity: N(p.quantity), allocatedBy: p.allocatedBy, allocatedAt: p.allocatedAt, note: p.note,
        materialCode: p.material.materialCode, materialName: p.material.name,
        currentStock: N(p.material.currentStock), reservedStock: N(p.material.reservedStock),
        availableQty: Math.max(0, N(p.material.currentStock) - N(p.material.reservedStock)),
        itemCode: p.prItem.itemCode, itemName: p.prItem.description, reqQty: N(p.prItem.reqQty),
      })),
    })
  } catch (err) {
    console.error('GET hard-pegging error:', err)
    return errorResponse('Lỗi tải giữ tồn', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, CAN)) return errorResponse('Không có quyền giữ tồn', 403)
    const body = await req.json().catch(() => ({})) as { prItemId?: string; quantity?: number | string; note?: string }
    const prItemId = String(body.prItemId || '')
    if (!prItemId) return errorResponse('Thiếu prItemId', 400)

    const prItem = await prisma.purchaseRequestItem.findUnique({
      where: { id: prItemId },
      select: { id: true, itemCode: true, reqQty: true, materialId: true, purchaseRequest: { select: { projectId: true } } },
    })
    if (!prItem) return errorResponse('Không tìm thấy dòng PR', 404)

    // Xác định mã kho: ưu tiên materialId; else khớp itemCode ↔ materialCode.
    let materialId = prItem.materialId
    if (!materialId && prItem.itemCode) {
      const m = await prisma.material.findFirst({ where: { materialCode: prItem.itemCode }, select: { id: true } })
      materialId = m?.id || null
    }
    if (!materialId) return errorResponse('Dòng PR chưa liên kết mã kho — không giữ tồn được', 400)

    const result = await prisma.$transaction(async (tx) => {
      const mat = await tx.material.findUnique({ where: { id: materialId! }, select: { currentStock: true, reservedStock: true } })
      if (!mat) throw new Error('MATERIAL_NOT_FOUND')
      const existing = await tx.hardPegging.findUnique({ where: { prItemId }, select: { quantity: true, status: true } })
      const currentPegged = existing && existing.status === 'ACTIVE' ? N(existing.quantity) : 0
      // Tồn khả dụng cho phần TĂNG THÊM = currentStock − reservedStock (reserved đã gồm phần đang giữ của chính dòng này).
      const availableForMore = Math.max(0, N(mat.currentStock) - N(mat.reservedStock))
      const reqQty = N(prItem.reqQty)
      // Mục tiêu giữ: quantity yêu cầu, else giữ đủ nhu cầu = min(khả-dụng+đang-giữ, reqQty).
      const target = body.quantity != null ? Math.max(0, N(body.quantity)) : Math.min(currentPegged + availableForMore, reqQty > 0 ? reqQty : currentPegged + availableForMore)
      const delta = target - currentPegged
      if (delta > availableForMore + 1e-6) {
        return { blocked: true, availableForMore, currentPegged, target } as const
      }
      // Áp delta vào reservedStock (tăng/giảm) + upsert pegging.
      await tx.material.update({ where: { id: materialId! }, data: { reservedStock: { increment: delta } } })
      await tx.hardPegging.upsert({
        where: { prItemId },
        create: { prItemId, materialId: materialId!, projectId: prItem.purchaseRequest?.projectId || null, quantity: target, status: 'ACTIVE', allocatedBy: user.userId, note: body.note || null },
        update: { quantity: target, status: 'ACTIVE', allocatedBy: user.userId, allocatedAt: new Date(), releasedAt: null, releasedBy: null, note: body.note ?? undefined },
      })
      return { blocked: false, target, delta, availableAfter: availableForMore - delta } as const
    })

    if ('blocked' in result && result.blocked) {
      return errorResponse(`Không đủ tồn khả dụng để giữ: cần thêm ${(result.target - result.currentPegged).toLocaleString('vi-VN')}, chỉ còn ${result.availableForMore.toLocaleString('vi-VN')}.`, 409)
    }
    await logAudit(user.userId, 'HARD_PEG_ALLOCATE', 'PurchaseRequestItem', prItemId, { materialId, target: result.target, delta: result.delta }, getClientIP(req))
    return successResponse({ prItemId, materialId, quantity: result.target, availableAfter: result.availableAfter }, `Đã giữ cứng ${result.target.toLocaleString('vi-VN')} cho dòng PR`)
  } catch (err) {
    console.error('POST hard-pegging error:', err)
    return errorResponse('Lỗi giữ tồn', 500)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, CAN)) return errorResponse('Không có quyền nhả tồn', 403)
    const prItemId = req.nextUrl.searchParams.get('prItemId') || ''
    if (!prItemId) return errorResponse('Thiếu prItemId', 400)

    const released = await prisma.$transaction(async (tx) => {
      const peg = await tx.hardPegging.findUnique({ where: { prItemId }, select: { materialId: true, quantity: true, status: true } })
      if (!peg || peg.status !== 'ACTIVE' || N(peg.quantity) <= 0) return { qty: 0 }
      await tx.material.update({ where: { id: peg.materialId }, data: { reservedStock: { decrement: N(peg.quantity) } } })
      await tx.hardPegging.update({ where: { prItemId }, data: { quantity: 0, status: 'RELEASED', releasedBy: user.userId, releasedAt: new Date() } })
      return { qty: N(peg.quantity), materialId: peg.materialId }
    })
    if (released.qty <= 0) return successResponse({ prItemId }, 'Dòng PR không có phần đang giữ')
    await logAudit(user.userId, 'HARD_PEG_RELEASE', 'PurchaseRequestItem', prItemId, { materialId: released.materialId, qty: released.qty }, getClientIP(req))
    return successResponse({ prItemId, released: released.qty }, `Đã nhả ${released.qty.toLocaleString('vi-VN')} tồn giữ cứng`)
  } catch (err) {
    console.error('DELETE hard-pegging error:', err)
    return errorResponse('Lỗi nhả tồn', 500)
  }
}
