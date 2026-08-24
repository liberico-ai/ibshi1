import prisma from '@/lib/db'

// Gate CỨNG phía server cho bước mua sắm P3.5/P3.6 — chặn hoàn thành nếu chưa có artifact mua sắm.
// Bổ sung cho UI StepBanner (soft-gate): đóng bước từ Hộp việc thường cũng phải qua luật này.
// Trả về chuỗi lỗi để chặn, hoặc null nếu cho qua. Non-fatal: lỗi DB → cho qua (không chặn nhầm).
export async function procurementStepGate(taskType: string | null | undefined, projectId: string | null | undefined): Promise<string | null> {
  if (!taskType || !projectId) return null
  try {
    if (taskType === 'P3.5') {
      // Cần ≥1 dòng BID đã chọn NCC (không tính BID đã hủy).
      const picked = await prisma.bidQuoteItem.findFirst({
        where: { bid: { projectId, status: { notIn: ['CANCELLED'] } }, selectedVendorName: { not: null } },
        select: { id: true },
      })
      if (!picked) return 'Chưa chọn nhà cung cấp cho dòng nào — vào màn Bidding chọn NCC trước khi hoàn thành bước P3.5.'
    }
    if (taskType === 'P3.6') {
      // Cần đã tạo PO từ BID: BID ở trạng thái CONTRACTED, hoặc có PO gắn bidAnalysisId.
      const contracted = await prisma.bidAnalysis.findFirst({ where: { projectId, status: 'CONTRACTED' }, select: { id: true } })
      if (!contracted) {
        const anyPo = await prisma.purchaseOrder.findFirst({ where: { projectId, bidAnalysisId: { not: null } }, select: { id: true } })
        if (!anyPo) return 'Chưa tạo PO từ BID nào — BGĐ cần “Tạo PO / HĐ” trước khi hoàn thành bước P3.6.'
      }
    }
  } catch (e) {
    console.error('[procurementStepGate] lỗi kiểm tra, cho qua:', e)
    return null
  }
  return null
}
