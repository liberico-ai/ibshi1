import prisma from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { guiHangCho } from '@/lib/integration/outbox'
import { sanSangGoiTM } from '@/lib/integration/config'

export const dynamic = 'force-dynamic'

// GET /api/cron/sync-commerce
//
// Tiến trình nền của đường ERP → ibs-commerce: lấy các bản tin đang chờ trong hộp thư đi
// và gửi sang. Chạy định kỳ (khuyến nghị mỗi 2 phút).
//
// Chỉ gửi hàng đợi — KHÔNG tự quét lại toàn bộ dữ liệu. Việc xếp hàng do nghiệp vụ làm ngay
// lúc dữ liệu đổi; cron mà tự quét thì mỗi lần chạy lại đụng cả nghìn bản ghi không đổi.

export async function GET() {
  const batDau = new Date()
  try {
    if (!sanSangGoiTM()) {
      return successResponse({
        message: 'Chưa cấu hình COMMERCE_API_URL / COMMERCE_API_KEY — đường đồng bộ đang tắt',
        skipped: true,
      })
    }

    const run = await prisma.syncRun.create({
      data: { direction: 'OUT', entity: 'outbox', startedAt: batDau },
      select: { id: true },
    })

    const kq = await guiHangCho(100)

    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        ok: kq.loi === 0,
        processed: kq.daGui,
        failed: kq.loi,
      },
    })

    return successResponse({
      message: `Đã gửi ${kq.daGui} bản tin, ${kq.loi} lỗi, còn ${kq.conLai} chờ`,
      ...kq,
    })
  } catch (err) {
    console.error('GET /api/cron/sync-commerce error:', err)
    // Ghi lại cả lượt hỏng: cron im lặng chết là thứ khó phát hiện nhất.
    await prisma.syncRun.create({
      data: {
        direction: 'OUT', entity: 'outbox', startedAt: batDau, finishedAt: new Date(),
        ok: false, error: (err as Error).message.slice(0, 500),
      },
    }).catch(() => {})
    return errorResponse('Lỗi gửi hàng đợi sang Thương mại', 500)
  }
}
