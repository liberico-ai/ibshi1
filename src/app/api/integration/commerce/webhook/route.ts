import { NextRequest } from 'next/server'
import { successResponse, errorResponse } from '@/lib/auth'
import { chuKyDung, nhanTrinhDuyet, type GoiTrinhDuyet } from '@/lib/integration/nhan-tu-tm'
import { commerceWebhookSecret } from '@/lib/integration/config'

export const dynamic = 'force-dynamic'

// POST /api/integration/commerce/webhook
//
// Cổng DUY NHẤT để ibs-commerce đẩy dữ liệu vào ERP. Một cổng thay vì mỗi loại một đường:
// chữ ký, chống trùng, nhật ký chỉ phải làm đúng một chỗ.
//
// Thân request:  { event: 'bid.submitted', data: { ... } }
// Tiêu đề bắt buộc:
//   X-Commerce-Signature : HMAC-SHA256 của NGUYÊN VĂN thân request, khoá COMMERCE_WEBHOOK_SECRET
//   Idempotency-Key      : khoá chống trùng của bên gửi (tuỳ chọn, để tra nhật ký)

export async function POST(req: NextRequest) {
  try {
    if (!commerceWebhookSecret()) {
      // Chưa cấu hình bí mật thì từ chối thẳng. Cho qua trong lúc chưa cấu hình là mở toang
      // một đường ghi dữ liệu mua sắm vào ERP cho bất kỳ ai gọi trúng URL.
      return errorResponse('ERP chưa cấu hình COMMERCE_WEBHOOK_SECRET — từ chối mọi webhook', 503)
    }

    // Phải đọc THÂN THÔ để tính chữ ký: JSON.parse rồi stringify lại là đổi thứ tự khoá,
    // đổi khoảng trắng, chữ ký không bao giờ khớp.
    const raw = await req.text()
    if (!chuKyDung(raw, req.headers.get('x-commerce-signature'))) {
      return errorResponse('Chữ ký không hợp lệ', 401)
    }

    let body: { event?: string; data?: unknown }
    try {
      body = JSON.parse(raw)
    } catch {
      return errorResponse('Thân request không phải JSON', 400)
    }

    const event = String(body.event || '').trim()
    if (!event) return errorResponse('Thiếu tên sự kiện', 400)

    switch (event) {
      // Thương mại so giá xong, chọn xong NCC → trình BGĐ duyệt trong ERP.
      case 'bid.submitted': {
        const kq = await nhanTrinhDuyet(body.data as GoiTrinhDuyet)
        if (!kq.ok) return errorResponse(kq.message, 409)
        return successResponse({ message: kq.message, approvalId: kq.id, warnings: kq.canhBao ?? [] })
      }

      default:
        // Trả 202 chứ không 400: Thương mại thêm sự kiện mới mà ERP chưa nhận thì đó không
        // phải lỗi của bên gửi — báo là chưa xử lý để họ khỏi thử lại vô hạn.
        return successResponse({ message: `ERP chưa xử lý sự kiện "${event}"`, handled: false })
    }
  } catch (err) {
    console.error('POST /api/integration/commerce/webhook error:', err)
    return errorResponse('Lỗi xử lý webhook Thương mại', 500)
  }
}
