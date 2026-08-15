import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const CAN_QUOTE = ['R01', 'R02', 'R07', 'R07a', 'R10']

/**
 * POST /api/procurement/bid-analyses/[id]/quotes
 * body: { vendorId?, vendorName, vendorType?, currency?, notes?, items: [{ itemId, unitPrice, totalPrice?, deliveryTerm?, remarks? }] }
 * [PORT Thương Mại] Nhập báo giá 1 NCC — bám enterVendorQuote: find/create BidQuoteVendor,
 * upsert offer theo (itemId, vendorId), recompute totalQuote = SUM(offer.totalPrice).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!CAN_QUOTE.includes(payload.roleCode)) return errorResponse('Bạn không có quyền nhập báo giá', 403)
    const { id: bidId } = await params

    const body = await req.json().catch(() => ({})) as {
      vendorId?: string; vendorName?: string; vendorType?: string; currency?: string; notes?: string
      items?: Array<{ itemId: string; unitPrice?: number; totalPrice?: number; deliveryTerm?: string; remarks?: string; scope?: string }>
    }
    const { vendorId, vendorType, currency, notes, items } = body
    const vendorName = (body.vendorName || '').trim() // chuẩn hoá: bỏ dấu cách thừa
    if (!vendorName) return errorResponse('Thiếu tên NCC (vendorName)', 400)
    if (!Array.isArray(items) || items.length === 0) return errorResponse('Cần ít nhất 1 dòng báo giá', 400)

    const bid = await prisma.bidAnalysis.findUnique({ where: { id: bidId }, select: { id: true } })
    if (!bid) return errorResponse('BID không tồn tại', 404)

    // Kiểm tra itemId thuộc bid này
    const validItems = await prisma.bidQuoteItem.findMany({
      where: { id: { in: items.map(i => i.itemId).filter(Boolean) }, bidId },
      select: { id: true },
    })
    const validSet = new Set(validItems.map(i => i.id))
    const bad = items.find(i => !validSet.has(i.itemId))
    if (bad) return errorResponse(`Dòng ${bad.itemId} không thuộc BID này`, 400)

    const result = await prisma.$transaction(async (tx) => {
      // find-or-create vendor theo (bidId, tên NCC) — KHÔNG phân biệt hoa/thường → cùng NCC = 1 cột,
      // không đẻ cột trùng do gõ khác kiểu chữ. NCC khác tên = cột riêng (để so sánh nhiều báo giá).
      let vendor = await tx.bidQuoteVendor.findFirst({
        where: { bidId, vendorName: { equals: vendorName, mode: 'insensitive' } },
      })
      if (!vendor) {
        const maxOrder = await tx.bidQuoteVendor.aggregate({ where: { bidId }, _max: { vendorOrder: true } })
        vendor = await tx.bidQuoteVendor.create({
          data: {
            bidId, vendorName, vendorId: vendorId || null,
            vendorOrder: (maxOrder._max.vendorOrder ?? -1) + 1,
            vendorType: vendorType || 'DOMESTIC', currency: currency || 'VND', notes: notes || null,
          },
        })
      } else {
        vendor = await tx.bidQuoteVendor.update({
          where: { id: vendor.id },
          data: {
            vendorId: vendorId ?? vendor.vendorId,
            currency: currency || vendor.currency,
            vendorType: vendorType || vendor.vendorType,
            notes: notes ?? vendor.notes,
          },
        })
      }

      // upsert offer theo (itemId, vendorId)
      for (const it of items) {
        const unitPrice = Number(it.unitPrice) || 0
        const qtyItem = await tx.bidQuoteItem.findUnique({ where: { id: it.itemId }, select: { qtyToBuy: true } })
        const totalPrice = it.totalPrice != null ? Number(it.totalPrice) : unitPrice * Number(qtyItem?.qtyToBuy || 0)
        await tx.bidQuoteOffer.upsert({
          where: { itemId_vendorId: { itemId: it.itemId, vendorId: vendor.id } },
          update: { unitPrice, totalPrice, scope: it.scope ?? null, deliveryTerm: it.deliveryTerm ?? null, remarks: it.remarks ?? null },
          create: { itemId: it.itemId, vendorId: vendor.id, unitPrice, totalPrice, scope: it.scope ?? null, deliveryTerm: it.deliveryTerm ?? null, remarks: it.remarks ?? null },
        })
      }

      // recompute totalQuote
      const sum = await tx.bidQuoteOffer.aggregate({ where: { vendorId: vendor.id }, _sum: { totalPrice: true } })
      vendor = await tx.bidQuoteVendor.update({
        where: { id: vendor.id }, data: { totalQuote: sum._sum.totalPrice || 0 },
      })
      // BID chuyển sang EVALUATING khi đã có báo giá
      await tx.bidAnalysis.updateMany({ where: { id: bidId, status: 'OPEN' }, data: { status: 'EVALUATING' } })
      return vendor
    })

    return successResponse(
      { vendorId: result.id, totalQuote: Number(result.totalQuote || 0) },
      `Đã nhập báo giá NCC ${vendorName}`, 201,
    )
  } catch (err) {
    console.error('POST /api/procurement/bid-analyses/[id]/quotes error:', err)
    return errorResponse('Lỗi nhập báo giá', 500)
  }
}
