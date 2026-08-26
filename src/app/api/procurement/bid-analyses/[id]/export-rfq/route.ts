import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/auth'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'
const N = (v: unknown) => Number(v || 0)

/**
 * GET /api/procurement/bid-analyses/[id]/export-rfq
 * Xuất BID ra Excel — bảng phân tích giá thầu (PRC-F07) để gửi NCC / lưu hồ sơ (khớp Commerce exportRfqExcel).
 * Cột theo từng NCC: đơn giá + thành tiền; kèm dự toán + NCC được chọn.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const { id } = await params

    const bid = await prisma.bidAnalysis.findUnique({
      where: { id },
      select: {
        bidCode: true, subject: true, bidDate: true,
        project: { select: { projectCode: true, projectName: true } },
        vendors: { orderBy: { vendorOrder: 'asc' }, select: { id: true, vendorName: true, currency: true } },
        items: {
          orderBy: { itemOrder: 'asc' },
          select: {
            itemOrder: true, itemCode: true, itemName: true, profile: true, grade: true, uom: true,
            qtyToBuy: true, estimateUnitPrice: true, selectedVendorName: true,
            offers: { select: { vendorId: true, unitPrice: true, totalPrice: true } },
          },
        },
      },
    })
    if (!bid) return errorResponse('Không tìm thấy BID', 404)

    const vendors = bid.vendors
    // Header: 8 cột cố định + 2 cột/NCC + dự toán + NCC chọn.
    const head1: (string | number)[] = ['STT', 'Mã VT', 'Tên vật tư', 'Quy cách', 'Mác', 'ĐVT', 'SL cần mua', 'Dự toán ĐG']
    const head2: (string | number)[] = ['', '', '', '', '', '', '', '']
    for (const v of vendors) { head1.push(v.vendorName, ''); head2.push('Đơn giá', 'Thành tiền') }
    head1.push('NCC được chọn'); head2.push('')

    const rows: (string | number)[][] = []
    for (const it of bid.items) {
      const qty = N(it.qtyToBuy)
      const r: (string | number)[] = [
        it.itemOrder ?? '', it.itemCode || '', it.itemName || '', it.profile || '', it.grade || '', it.uom || '',
        qty, N(it.estimateUnitPrice) || '',
      ]
      for (const v of vendors) {
        const off = it.offers.find(o => o.vendorId === v.id)
        const up = N(off?.unitPrice)
        const tp = N(off?.totalPrice) > 0 ? N(off?.totalPrice) : up * qty
        r.push(up || '', up || tp ? tp : '')
      }
      r.push(it.selectedVendorName || '')
      rows.push(r)
    }

    const aoa: (string | number)[][] = [
      [`BẢNG PHÂN TÍCH GIÁ THẦU — ${bid.bidCode}`],
      [`Dự án: ${bid.project?.projectCode || ''} — ${bid.project?.projectName || ''}`],
      [`Chủ đề: ${bid.subject || ''}`],
      [],
      head1, head2, ...rows,
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = [{ wch: 5 }, { wch: 14 }, { wch: 26 }, { wch: 20 }, { wch: 14 }, { wch: 6 }, { wch: 10 }, { wch: 12 }, ...vendors.flatMap(() => [{ wch: 12 }, { wch: 14 }]), { wch: 20 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'BID ANALYSIS')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="RFQ-${bid.bidCode}.xlsx"`,
      },
    })
  } catch (err) {
    console.error('GET export-rfq error:', err)
    return errorResponse('Lỗi xuất RFQ', 500)
  }
}
