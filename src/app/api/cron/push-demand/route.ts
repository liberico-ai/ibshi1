import { NextRequest } from 'next/server'
import { successResponse, errorResponse } from '@/lib/auth'
import prisma from '@/lib/db'
import { dayDuAn, dayNhuCau } from '@/lib/integration/day-sang-tm'
import { guiHangCho } from '@/lib/integration/outbox'
import { sanSangGoiTM } from '@/lib/integration/config'

export const dynamic = 'force-dynamic'

// GET /api/cron/push-demand[?projectCode=...]
//
// Tự gom NHU CẦU (BOM) của các dự án đang chạy → xếp hàng → gửi sang Thương mại, KHÔNG cần ai
// bấm nút. Bảo vệ bằng x-cron-secret (middleware). Dùng đúng dayDuAn + dayNhuCau nên có
// change-detection: dự án nào không đổi thì bỏ qua, không spam.
//
// Chạy định kỳ (khuyến nghị mỗi 2-5 phút). Đây là "kéo tự động" cho lần nối đầu + dữ liệu cũ;
// khi BOM đổi thì nghiệp vụ đã tự đẩy ngay, cron này chỉ là lưới hứng.
export async function GET(req: NextRequest) {
  try {
    if (!sanSangGoiTM()) {
      return successResponse({
        message: 'Chưa cấu hình COMMERCE_API_URL / COMMERCE_API_KEY — đường đồng bộ đang tắt',
        skipped: true,
      })
    }

    const { searchParams } = new URL(req.url)
    const projectCode = (searchParams.get('projectCode') || '').trim()

    const projects = await prisma.project.findMany({
      where: { status: 'ACTIVE', ...(projectCode ? { projectCode } : {}) },
      select: { id: true, projectCode: true },
    })

    const results: Array<Record<string, unknown>> = []
    for (const p of projects) {
      const du = await dayDuAn(p.id)
      const nc = await dayNhuCau(p.id)
      results.push({ projectCode: p.projectCode, project: du, demand: nc })
    }

    const kq = await guiHangCho(500)

    // Chẩn đoán: bản tin đang kẹt (PENDING/FAILED) kèm lastError — để biết vì sao chưa sang được.
    const stuck = await prisma.syncOutbox.findMany({
      where: { status: { in: ['PENDING', 'FAILED'] } },
      select: { event: true, status: true, attempts: true, lastError: true },
      orderBy: { createdAt: 'desc' },
      take: 6,
    })

    return successResponse({
      message: `Quét ${projects.length} dự án · gửi ${kq.daGui} bản tin · ${kq.loi} lỗi · còn ${kq.conLai} chờ`,
      projects: projects.length,
      sent: kq.daGui,
      failed: kq.loi,
      remaining: kq.conLai,
      stuck,
      results,
    })
  } catch (err) {
    console.error('GET /api/cron/push-demand error:', err)
    return errorResponse('Lỗi push demand sang Thương mại', 500)
  }
}
