// Cấu hình đường nối ERP ↔ ibs-commerce.
//
// Hai hệ chạy trên hai máy chủ, hai cơ sở dữ liệu khác nhau. Mọi thứ ERP cần biết về hệ kia
// gói gọn trong ba biến môi trường dưới đây — không rải URL/khoá vào từng file gọi API.

/** Hệ ngoài duy nhất hiện có. Đặt tên hằng để không gõ tay chuỗi 'commerce' ở chục chỗ. */
export const HE_TM = 'commerce'

/** Gốc API của Thương mại, ví dụ https://tm.ibs.vn/api/v1 — thiếu thì đường đồng bộ nằm im. */
export function commerceBaseUrl(): string | null {
  const v = (process.env.COMMERCE_API_URL || '').trim().replace(/\/+$/, '')
  return v || null
}

/** Khoá dịch vụ ERP dùng để gọi sang Thương mại (Thương mại cấp). */
export function commerceApiKey(): string | null {
  return (process.env.COMMERCE_API_KEY || '').trim() || null
}

/**
 * Bí mật ký webhook Thương mại gửi sang ERP. Dùng để xác minh chữ ký HMAC — không có thì
 * ERP từ chối mọi webhook, vì nhận dữ liệu không ký nghĩa là ai cũng đẩy được vào.
 */
export function commerceWebhookSecret(): string | null {
  return (process.env.COMMERCE_WEBHOOK_SECRET || '').trim() || null
}

/** Đường nối đã khai báo đủ để gọi đi chưa. */
export function sanSangGoiTM(): boolean {
  return !!commerceBaseUrl() && !!commerceApiKey()
}

/** Số lần thử lại một bản tin trong hộp thư đi trước khi bỏ cuộc và báo lỗi. */
export const SO_LAN_THU = 6

/** Giãn cách thử lại (phút) — thưa dần để hệ kia có thời gian hồi phục. */
export const GIAN_CACH_PHUT = [1, 5, 15, 60, 180, 360]
