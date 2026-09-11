import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET /api/procurement/commerce-approvals?status=PENDING&projectId=
//
// Danh sách đợt báo giá Thương mại trình BGĐ duyệt. Dữ liệu là BẢN GƯƠNG từ ibs-commerce —
// ERP không sửa nội dung, chỉ ghi quyết định.

/** Ai được xem: BGĐ duyệt, PM theo dõi dự án của mình, KTKH đối chiếu giá, Admin. */
const DUOC_XEM = ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R10']

export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!DUOC_XEM.includes(user.roleCode)) {
      return errorResponse('Bạn không có quyền xem đợt duyệt báo giá', 403)
    }

    const sp = req.nextUrl.searchParams
    const status = (sp.get('status') || '').trim().toUpperCase()
    const projectId = (sp.get('projectId') || '').trim()

    const ds = await prisma.commerceApproval.findMany({
      where: {
        ...(status && status !== 'ALL' ? { status } : {}),
        ...(projectId ? { projectId } : {}),
      },
      orderBy: [{ status: 'asc' }, { submittedAt: 'desc' }],
      select: {
        id: true, bidCode: true, subject: true, projectCode: true, projectId: true,
        selectionMode: true, currency: true, totalValue: true, fileUrl: true,
        submittedBy: true, submittedAt: true,
        status: true, decidedBy: true, decidedAt: true, reason: true, notifiedAt: true,
        project: { select: { projectCode: true, projectName: true } },
        _count: { select: { lines: true } },
      },
    })

    return successResponse({
      approvals: ds.map(a => ({
        id: a.id,
        bidCode: a.bidCode,
        subject: a.subject,
        // Dự án chưa tra được thì trả mã thô để người dùng biết đường đối chiếu, không giấu đi.
        projectCode: a.project?.projectCode ?? a.projectCode,
        projectName: a.project?.projectName ?? null,
        chuaGanDuAn: !a.projectId,
        selectionMode: a.selectionMode,
        currency: a.currency,
        totalValue: Number(a.totalValue),
        fileUrl: a.fileUrl,
        lineCount: a._count.lines,
        submittedBy: a.submittedBy,
        submittedAt: a.submittedAt,
        status: a.status,
        decidedBy: a.decidedBy,
        decidedAt: a.decidedAt,
        reason: a.reason,
        /** Đã báo quyết định về Thương mại chưa — chưa thì đường đồng bộ đang tồn việc. */
        daBaoVeTM: !!a.notifiedAt,
      })),
    })
  } catch (err) {
    console.error('GET /api/procurement/commerce-approvals error:', err)
    return errorResponse('Lỗi tải danh sách đợt duyệt', 500)
  }
}
