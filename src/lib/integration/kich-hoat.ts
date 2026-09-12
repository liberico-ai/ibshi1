import { dayDuAn, dayDuToan, dayNhuCau } from './day-sang-tm'
import { guiHangCho } from './outbox'
import { sanSangGoiTM } from './config'

// Móc tự động: dữ liệu ERP đổi → xếp hàng NGAY → gửi sang Thương mại NGAY.
//
// Trước đây chỉ có nút đẩy tay và tiến trình nền chạy theo lịch. Nghĩa là up dự toán xong,
// Thương mại phải chờ tới lượt cron mới có dữ liệu — mà đúng lúc cần làm việc thì lại thiếu.
// Giờ mỗi lần dữ liệu đổi là đẩy luôn, cron chỉ còn là lưới hứng cho những lần gửi hỏng.
//
// Nguyên tắc: KHÔNG làm chậm và KHÔNG làm hỏng thao tác của người dùng.
//   • Người dùng bấm Lưu → ERP lưu xong, trả lời xong, RỒI mới đẩy
//   • Đẩy hỏng thì thôi, bản tin vẫn nằm trong hộp thư đi và cron gửi lại sau
//   • Mọi lỗi ở đây đều nuốt: không ai chấp nhận "lưu dự toán thất bại vì hệ khác đang sập"

/** Đẩy hàng đợi đi ngay, âm thầm. Không chờ, không ném lỗi ra ngoài. */
function guiNgay(): void {
  if (!sanSangGoiTM()) return
  // Không await: người dùng đã được trả lời rồi, việc gửi để chạy nền.
  guiHangCho(20).catch(e => console.error('[đồng bộ TM] gửi ngay hỏng:', (e as Error).message))
}

/**
 * Dự toán của dự án vừa đổi.
 * Gọi sau khi ĐÃ lưu vào DB — không gọi trước, vì hàm đọc lại dữ liệu từ DB để dựng gói tin.
 */
export function duToanDaDoi(projectId: string | null | undefined): void {
  if (!projectId) return
  void (async () => {
    try {
      // Dự án phải sang trước dự toán: Thương mại tra theo mã dự án, không có thì trả 404.
      await dayDuAn(projectId)
      await dayDuToan(projectId)
      guiNgay()
    } catch (e) {
      console.error('[đồng bộ TM] xếp hàng dự toán hỏng:', (e as Error).message)
    }
  })()
}

/** BOM/APL của dự án vừa đổi → nhu cầu mua đổi theo. */
export function nhuCauDaDoi(projectId: string | null | undefined): void {
  if (!projectId) return
  void (async () => {
    try {
      await dayDuAn(projectId)
      await dayNhuCau(projectId)
      guiNgay()
    } catch (e) {
      console.error('[đồng bộ TM] xếp hàng nhu cầu hỏng:', (e as Error).message)
    }
  })()
}

/** Thông tin dự án vừa đổi (tên, khách hàng, trạng thái). */
export function duAnDaDoi(projectId: string | null | undefined): void {
  if (!projectId) return
  void (async () => {
    try {
      await dayDuAn(projectId)
      guiNgay()
    } catch (e) {
      console.error('[đồng bộ TM] xếp hàng dự án hỏng:', (e as Error).message)
    }
  })()
}

/**
 * Có bản tin vừa được xếp hàng ở nơi khác (vd BGĐ duyệt báo giá) → đẩy đi ngay.
 * Tách riêng để chỗ gọi không phải nhớ import guiHangCho.
 */
export function daXepHangMoi(): void {
  guiNgay()
}

/**
 * Khoá dữ liệu của biểu mẫu DỰ TOÁN — lấy đúng theo KEY_TO_FORM trong constants.ts.
 * Đổi bất kỳ khoá nào ở đây là bộ số dự toán đã khác, phải đẩy lại sang Thương mại.
 */
export const KHOA_DU_TOAN = [
  'totalMaterial', 'totalLabor', 'totalService', 'totalOverhead', 'totalEstimate',
  'dt02Detail', 'estimateFileName',
]

/** Khoá dữ liệu BOM/PR — đổi thì nhu cầu mua đổi theo. */
export const KHOA_BOM = ['bomPr', 'bomItemsList', 'aplImportId']
