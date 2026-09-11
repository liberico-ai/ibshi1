import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { commerceBaseUrl, commerceApiKey, commerceWebhookSecret } from '@/lib/integration/config'

export const dynamic = 'force-dynamic'

// GET /api/integration/commerce/status
//
// Tình trạng đường đồng bộ ERP ↔ ibs-commerce. Có màn này NGAY TỪ ĐẦU là có chủ ý: lúc số liệu
// hai bên vênh nhau, thứ cần biết đầu tiên là "lần cuối chạy khi nào, còn tồn bao nhiêu, lỗi gì".
// Không có nó thì chỉ còn cách mò log máy chủ.

const DUOC_XEM = ['R01', 'R10']

export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!DUOC_XEM.includes(user.roleCode)) {
      return errorResponse('Chỉ BGĐ và Quản trị xem được tình trạng đồng bộ', 403)
    }

    const [theoTrangThai, tonDong, hongGanDay, luotGanDay, soLien, choDuyet] = await Promise.all([
      prisma.syncOutbox.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.syncOutbox.findFirst({
        where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' },
        select: { createdAt: true, event: true },
      }),
      prisma.syncOutbox.findMany({
        where: { status: 'FAILED' }, orderBy: { createdAt: 'desc' }, take: 10,
        select: { id: true, event: true, entityId: true, attempts: true, lastError: true, createdAt: true },
      }),
      prisma.syncRun.findMany({
        orderBy: { startedAt: 'desc' }, take: 10,
        select: {
          id: true, direction: true, entity: true, startedAt: true, finishedAt: true,
          ok: true, processed: true, failed: true, error: true,
        },
      }),
      prisma.integrationLink.count(),
      prisma.commerceApproval.count({ where: { status: 'PENDING' } }),
    ])

    const dem = Object.fromEntries(theoTrangThai.map(r => [r.status, r._count._all]))
    const cauHinhDu = !!commerceBaseUrl() && !!commerceApiKey() && !!commerceWebhookSecret()

    return successResponse({
      cauHinh: {
        du: cauHinhDu,
        coUrl: !!commerceBaseUrl(),
        coKhoaGoiDi: !!commerceApiKey(),
        coBiMatNhanVe: !!commerceWebhookSecret(),
      },
      hopThuDi: {
        cho: dem.PENDING || 0,
        daGui: dem.SENT || 0,
        hong: dem.FAILED || 0,
        // Bản tin chờ lâu nhất — chờ quá vài phút là dấu hiệu cron không chạy.
        choLauNhat: tonDong ? { event: tonDong.event, tu: tonDong.createdAt } : null,
      },
      banHong: hongGanDay,
      luotGanDay,
      soCapDaNoi: soLien,
      dotChoBGDDuyet: choDuyet,
    })
  } catch (err) {
    console.error('GET /api/integration/commerce/status error:', err)
    return errorResponse('Lỗi đọc tình trạng đồng bộ', 500)
  }
}
