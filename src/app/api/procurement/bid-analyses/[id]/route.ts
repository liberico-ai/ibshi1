import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { groupCodeOf, groupLabelOf } from '@/lib/material-group'

export const dynamic = 'force-dynamic'

/**
 * GET /api/procurement/bid-analyses/[id]
 * [PORT Thương Mại] Chi tiết BID: vendors (cột) + items (dòng) + offers (ô giá) → ma trận so sánh.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params

    const bid = await prisma.bidAnalysis.findUnique({
      where: { id },
      select: {
        id: true, bidCode: true, subject: true, status: true, selectionMode: true,
        bidCodeMat: true, bidCodeUrgent: true, bidDate: true, notes: true,
        legacyBidCode: true, sourceFileName: true, sourceFilePath: true, weightingCriteria: true,
        project: { select: { id: true, projectCode: true, projectName: true } },
        vendors: {
          orderBy: { vendorOrder: 'asc' },
          select: { id: true, vendorId: true, vendorName: true, vendorType: true, currency: true, totalQuote: true, isWinner: true },
        },
        purchaseOrders: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, poCode: true, status: true, totalValue: true, currency: true, vendor: { select: { name: true } } },
        },
        items: {
          orderBy: { itemOrder: 'asc' },
          select: {
            id: true, itemOrder: true, itemCode: true, itemName: true, profile: true, grade: true, uom: true,
            qtyPr: true, qtyToBuy: true, estimateUnitPrice: true, alreadyBoughtAmount: true,
            selectedVendorName: true, notes: true,
            offers: { select: { vendorId: true, scope: true, unitPrice: true, totalPrice: true, deliveryTerm: true, remarks: true } },
          },
        },
      },
    })
    if (!bid) return errorResponse('Không tìm thấy BID', 404)

    return successResponse({
      bid: {
        id: bid.id, bidCode: bid.bidCode, subject: bid.subject, status: bid.status,
        selectionMode: bid.selectionMode, matGroup: bid.bidCodeMat, urgent: bid.bidCodeUrgent,
        bidDate: bid.bidDate, notes: bid.notes, project: bid.project,
        legacyBidCode: bid.legacyBidCode, sourceFileName: bid.sourceFileName, sourceFilePath: bid.sourceFilePath,
        weightingCriteria: bid.weightingCriteria,
      },
      vendors: bid.vendors.map(v => ({
        id: v.id, vendorId: v.vendorId, vendorName: v.vendorName, vendorType: v.vendorType,
        currency: v.currency, totalQuote: Number(v.totalQuote || 0), isWinner: v.isWinner,
      })),
      purchaseOrders: bid.purchaseOrders.map(p => ({
        id: p.id, poCode: p.poCode, status: p.status, currency: p.currency,
        totalValue: Number(p.totalValue || 0), vendorName: p.vendor?.name || '',
      })),
      items: bid.items.map(it => ({
        id: it.id, itemOrder: it.itemOrder, itemCode: it.itemCode, itemName: it.itemName,
        profile: it.profile, grade: it.grade, uom: it.uom,
        groupCode: groupCodeOf(it), groupLabel: groupLabelOf(groupCodeOf(it)),
        qtyToBuy: Number(it.qtyToBuy || 0), qtyPr: Number(it.qtyPr || 0),
        estimateUnitPrice: Number(it.estimateUnitPrice || 0),
        estimateTotal: Number(it.estimateUnitPrice || 0) * Number(it.qtyToBuy || 0),
        alreadyBoughtAmount: Number(it.alreadyBoughtAmount || 0),
        selectedVendorName: it.selectedVendorName, notes: it.notes,
        // ma trận: { [bidQuoteVendor.id]: {scope,unitPrice,totalPrice,...} }
        offers: Object.fromEntries(it.offers.map(o => [o.vendorId, {
          scope: o.scope, unitPrice: Number(o.unitPrice || 0), totalPrice: Number(o.totalPrice || 0),
          deliveryTerm: o.deliveryTerm, remarks: o.remarks,
        }])),
      })),
    })
  } catch (err) {
    console.error('GET /api/procurement/bid-analyses/[id] error:', err)
    return errorResponse('Lỗi tải chi tiết BID', 500)
  }
}
