// #6 — 15 mốc thời gian quy trình mua sắm (QT19-TM PHA B) — CHỈ GHI NHẬN thời điểm, không enforce.
export const PROCUREMENT_MILESTONES: Array<{ no: number; label: string; phase: string }> = [
  { no: 1, label: 'Tiếp nhận PR', phase: '4 · Tìm nguồn' },
  { no: 2, label: 'Soát tính phù hợp dữ liệu PR', phase: '4 · Tìm nguồn' },
  { no: 3, label: 'Thiết kế/Dự án trả lời — vòng 1', phase: '4 · Tìm nguồn' },
  { no: 4, label: 'Tìm NCC, gửi dữ liệu mời chào giá', phase: '4 · Tìm nguồn' },
  { no: 5, label: 'NCC phản hồi khả năng cấp hàng', phase: '4 · Tìm nguồn' },
  { no: 6, label: 'Tiếp nhận câu hỏi ngược từ NCC', phase: '4 · Tìm nguồn' },
  { no: 7, label: 'Thiết kế/Dự án trả lời — vòng 2', phase: '4 · Tìm nguồn' },
  { no: 8, label: 'NCC gửi báo giá', phase: '4 · Tìm nguồn' },
  { no: 9, label: 'Tổng hợp báo giá, lập bảng giải trình', phase: '5 · Duyệt' },
  { no: 10, label: 'Thống nhất hình thức thanh toán với NCC', phase: '5 · Duyệt' },
  { no: 11, label: 'NCC lập file hợp đồng', phase: '5 · Duyệt' },
  { no: 12, label: 'Ký hợp đồng', phase: '5 · Duyệt' },
  { no: 13, label: 'Chuyển hợp đồng sang Tài chính Kế toán', phase: '5 · Duyệt' },
  { no: 14, label: 'Tài chính Kế toán kiểm tra và phản hồi', phase: '5 · Duyệt' },
  { no: 15, label: 'Triển khai hợp đồng', phase: '5 · Duyệt' },
]
export const MILESTONE_LABEL: Record<number, string> = Object.fromEntries(PROCUREMENT_MILESTONES.map(m => [m.no, m.label]))
