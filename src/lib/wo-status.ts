// ─────────────────────────────────────────────────────────────────────────────
// Trạng thái lệnh sản xuất — một nguồn duy nhất cho cả server lẫn giao diện.
//
// Trước đây màn "Phiếu công việc" tự nạp mỗi OPEN + IN_PROGRESS, trong khi API tạo phiếu
// chỉ chặn COMPLETED/CANCELLED. Từ khi cắt cổng vật tư (09/2026), lệnh nằm nguyên ở
// PENDING_MATERIAL mà xưởng vẫn báo cáo được → ô chọn WO rỗng sạch. Khai một chỗ để
// hai bên không bao giờ lệch nhau nữa.
// ─────────────────────────────────────────────────────────────────────────────

/** Lệnh đã đóng sổ — không nhận thêm phiếu báo khối lượng. */
export const WO_CLOSED_STATUSES = ['COMPLETED', 'CANCELLED'] as const

/** Mọi trạng thái còn nhận phiếu báo khối lượng. */
export const WO_REPORTABLE_STATUSES = [
  'PENDING_MATERIAL', 'OPEN', 'IN_PROGRESS', 'ON_HOLD',
  'QC_PENDING', 'QC_PASSED', 'QC_FAILED',
] as const

export function isWoReportable(status: string): boolean {
  return !WO_CLOSED_STATUSES.includes(status as (typeof WO_CLOSED_STATUSES)[number])
}

/** Nhãn ngắn để giao diện nói rõ lệnh đang ở đâu ngay trong ô chọn. */
export const WO_STATUS_LABEL: Record<string, string> = {
  PENDING_MATERIAL: 'Chờ vật tư',
  OPEN: 'Đã phát hành',
  IN_PROGRESS: 'Đang SX',
  ON_HOLD: 'Tạm dừng',
  QC_PENDING: 'Chờ nghiệm thu',
  QC_PASSED: 'Đã nghiệm thu',
  QC_FAILED: 'Nghiệm thu lỗi',
  COMPLETED: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
}
