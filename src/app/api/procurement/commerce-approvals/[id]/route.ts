import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET /api/procurement/commerce-approvals/[id]
// Chi tiết một đợt: đủ dòng vật tư, NCC đã chọn, giá, và báo giá của các NCC khác để đối chiếu.

const DUOC_XEM = ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R10']

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!DUOC_XEM.includes(user.roleCode)) {
      return errorResponse('Bạn không có quyền xem đợt duyệt báo giá', 403)
    }
    const { id } = await params

    const a = await prisma.commerceApproval.findUnique({
      where: { id },
      include: {
        project: { select: { projectCode: true, projectName: true } },
        lines: { orderBy: { lineNo: 'asc' } },
      },
    })
    if (!a) return errorResponse('Không tìm thấy đợt duyệt', 404)

    const dong = a.lines.map(l => {
      const gia = Number(l.unitPrice)
      const duToan = l.estUnitPrice === null ? null : Number(l.estUnitPrice)
      return {
        id: l.id,
        lineNo: l.lineNo,
        itemCode: l.itemCode,
        itemName: l.itemName,
        profile: l.profile,
        grade: l.grade,
        uom: l.uom,
        quantity: Number(l.quantity),
        vendorName: l.vendorName,
        unitPrice: gia,
        totalPrice: Number(l.totalPrice),
        estUnitPrice: duToan,
        // Vượt dự toán bao nhiêu phần trăm — BGĐ cần thấy ngay con số này chứ không phải tự nhẩm.
        vuotDuToanPct: duToan && duToan > 0 ? Math.round(((gia - duToan) / duToan) * 1000) / 10 : null,
        offers: l.offers,
        notes: l.notes,
      }
    })

    return successResponse({
      approval: {
        id: a.id,
        bidCode: a.bidCode,
        subject: a.subject,
        projectCode: a.project?.projectCode ?? a.projectCode,
        projectName: a.project?.projectName ?? null,
        chuaGanDuAn: !a.projectId,
        selectionMode: a.selectionMode,
        currency: a.currency,
        totalValue: Number(a.totalValue),
        fileUrl: a.fileUrl,
        submittedBy: a.submittedBy,
        submittedAt: a.submittedAt,
        status: a.status,
        decidedBy: a.decidedBy,
        decidedAt: a.decidedAt,
        reason: a.reason,
        daBaoVeTM: !!a.notifiedAt,
      },
      lines: dong,
      // Số dòng vượt dự toán — để giao diện nhấn cảnh báo ngay đầu trang.
      soDongVuotDuToan: dong.filter(d => (d.vuotDuToanPct ?? 0) > 0).length,
    })
  } catch (err) {
    console.error('GET /api/procurement/commerce-approvals/[id] error:', err)
    return errorResponse('Lỗi tải chi tiết đợt duyệt', 500)
  }
}
