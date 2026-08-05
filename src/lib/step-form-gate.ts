// ── Gate: chặn "Hoàn thành" bước nếu chưa có dữ liệu BIỂU MẪU bắt buộc ──
// Ngăn tình huống user up biểu mẫu nhầm vào "Bằng chứng thực hiện" / chưa Import
// → các bước sau (Budget, P2.4/P2.5, thiết kế, thương mại…) bị khuyết dữ liệu.
//
// Trả về CHUỖI LỖI nếu thiếu (chặn hoàn thành), null nếu OK.
// Chỉ áp cho bước tạo mới từ nay — task đã DONE trước đó không bị ảnh hưởng
// (đã có tính năng "Bổ sung/Chỉnh sửa dự toán" để vá).
export function stepFormGate(taskType: string | null | undefined, resultData: unknown): string | null {
  const rd = (resultData && typeof resultData === 'object' && !Array.isArray(resultData))
    ? (resultData as Record<string, unknown>)
    : {}
  switch (taskType) {
    case 'P1.2': {
      // Dự toán thi công: phải đã Import (có 4 tổng → totalEstimate > 0)
      const total = Number(rd.totalEstimate) || 0
      if (!(total > 0)) {
        return 'Chưa Import biểu mẫu dự toán (chưa có 4 tổng chi phí). Hãy dùng nút "Import lại dự toán" để nạp số từ file Excel TRƯỚC khi hoàn thành — nếu không các bước sau (Ngân sách, P2.4/P2.5…) sẽ khuyết dữ liệu. Lưu ý: đính kèm ở "Bằng chứng thực hiện" KHÔNG bóc được số.'
      }
      break
    }
  }
  return null
}
