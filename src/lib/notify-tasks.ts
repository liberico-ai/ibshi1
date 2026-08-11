// ── Task "THÔNG BÁO" ────────────────────────────────────────────────────────
// Một số bước quy trình (nghiệm thu chất lượng, nhập kho…) nay được LÀM Ở SIDEBAR
// theo PO, KHÔNG thao tác ở tab Công việc nữa. Task tương ứng ở Công việc chỉ còn
// mang tính THÔNG BÁO: mở ra → hiện card gọn + nút mở đúng tab sidebar; mở lần đầu
// thì tự đánh dấu "đã đọc" (ẩn khỏi Hộp việc). Trạng thái Đạt/Không đạt thật sự
// được ghi ở chính tab sidebar, không phải ở đây.
export interface NotifyTaskInfo {
  sidebar: string   // đường dẫn tab sidebar để làm việc thật
  label: string     // nhãn nút "Mở tab …"
  hint: string      // hướng dẫn ngắn hiển thị trong card
  // Cách xử lý khi mở task thông báo:
  //  • 'dismiss'  — bước ĐÃ GỠ khỏi chuỗi gate (P4.3/P4.4): mở lần đầu là ẩn luôn (set CANCELLED).
  //  • 'redirect' — bước CÒN trong chuỗi 32 bước: KHÔNG ẩn khi mở; task sẽ tự DONE khi hoàn tất
  //                 việc ở tab sidebar (qua completeStepTaskFromSidebar) → chuỗi chạy tiếp (Cách A).
  mode: 'dismiss' | 'redirect'
  // true → redirect kèm projectId dạng PATH: `${sidebar}/${projectId}` (vd trang chi tiết dự án).
  projectScoped?: boolean
  // set → redirect kèm projectId dạng QUERY: `${sidebar}?${projectQuery}=${projectId}` (vd tab list lọc theo dự án).
  projectQuery?: string
}

export const NOTIFY_TASK_MAP: Record<string, NotifyTaskInfo> = {
  // P4.3 — QAQC nghiệm thu chất lượng hàng về (sinh khi TM xác nhận hàng về) — NGOÀI chuỗi
  'P4.3': {
    sidebar: '/dashboard/qc',
    label: 'Chất lượng',
    hint: 'Vào mục "Nghiệm thu vật tư" ở tab Chất lượng để kiểm tra chất lượng hàng về theo PO.',
    mode: 'dismiss',
  },
  // P4.4 — Kho nghiệm thu khối lượng + nhập kho — NGOÀI chuỗi
  'P4.4': {
    sidebar: '/dashboard/warehouse/grn',
    label: 'Kho — Nhập hàng',
    hint: 'Vào mục "Nhập hàng (GRN)" để nghiệm thu khối lượng và nhập kho theo PO.',
    mode: 'dismiss',
  },
  // ── Quy trình 32 bước (mode 'redirect') — cắm dần theo từng Phase ──
  // Phase 1
  'P1.1': {
    sidebar: '/dashboard/projects',
    label: 'Dự án',
    hint: 'PM mở dự án để hoàn tất khởi tạo & gửi BGĐ duyệt triển khai (P1.1B).',
    mode: 'redirect',
    projectScoped: true,
  },
  'P1.1B': {
    sidebar: '/dashboard/projects',
    label: 'Dự án',
    hint: 'BGĐ mở dự án để xem hồ sơ và bấm "Duyệt triển khai" (hoặc Từ chối kèm lý do).',
    mode: 'redirect',
    projectScoped: true,
  },
  'P1.2A': {
    sidebar: '/dashboard/milestones',
    label: 'Cột mốc',
    hint: 'PM mở tab Cột mốc để lập WBS (phân rã hạng mục), mốc thanh toán và tải biên bản kickoff.',
    mode: 'redirect',
    projectQuery: 'project',
  },
  'P1.2': {
    sidebar: '/dashboard/estimates',
    label: 'Dự toán',
    hint: 'KTKH mở tab Dự toán để nạp dự toán (Import Excel DT02 → 4 tổng chi phí) rồi hoàn thành.',
    mode: 'redirect',
    projectQuery: 'project',
  },
  'P1.3': {
    sidebar: '/dashboard/projects',
    label: 'Dự án',
    hint: 'BGĐ mở dự án để xem kế hoạch (WBS) + dự toán rồi "Duyệt" (hoặc Từ chối kèm lý do).',
    mode: 'redirect',
    projectScoped: true,
  },
  // ── Phase 2 — các bước LÀM (redirect về sân của từng phòng, Cách A) ──
  // P2.1 Thiết kế đề xuất VT chính (PR) — Định mức vật tư (Thiết kế)
  'P2.1': {
    sidebar: '/dashboard/design/bom',
    label: 'Định mức vật tư',
    hint: 'Thiết kế mở tab Định mức vật tư để lập bản vẽ + đề xuất VT chính (PR) rồi hoàn thành.',
    mode: 'redirect',
    projectQuery: 'project',
  },
  // P2.2 PM đề xuất vật tư hàn & sơn — Định mức vật tư
  'P2.2': {
    sidebar: '/dashboard/design/bom',
    label: 'Định mức vật tư',
    hint: 'PM mở tab Định mức vật tư để đề xuất vật tư hàn & sơn rồi hoàn thành.',
    mode: 'redirect',
    projectQuery: 'project',
  },
  // P2.3 Kho đề xuất vật tư tiêu hao — Kho
  'P2.3': {
    sidebar: '/dashboard/warehouse',
    label: 'Kho',
    hint: 'Kho mở tab Kho để đề xuất vật tư tiêu hao (tận dụng tồn) rồi hoàn thành.',
    mode: 'redirect',
    projectQuery: 'project',
  },
  // P2.1A Lập kế hoạch dòng tiền — Dòng tiền (Tài chính)
  'P2.1A': {
    sidebar: '/dashboard/finance/cashflow',
    label: 'Dòng tiền',
    hint: 'Tài chính mở tab Dòng tiền để lập kế hoạch dòng tiền (đính kèm bằng chứng) rồi hoàn thành.',
    mode: 'redirect',
    projectQuery: 'project',
  },
  // P2.4 KTKH điều chỉnh dự toán — Dự toán
  'P2.4': {
    sidebar: '/dashboard/estimates',
    label: 'Dự toán',
    hint: 'KTKH mở tab Dự toán để điều chỉnh dự toán (tổng hợp đề xuất VT) rồi hoàn thành.',
    mode: 'redirect',
    projectQuery: 'project',
  },
  // Phase 2 — BGĐ duyệt KH SX + dự toán chính thức (card ở trang Dự án như P1.3)
  'P2.5': {
    sidebar: '/dashboard/projects',
    label: 'Dự án',
    hint: 'BGĐ mở dự án để duyệt kế hoạch sản xuất & dự toán chính thức (hoặc Từ chối kèm lý do).',
    mode: 'redirect',
    projectScoped: true,
  },
  // Phase 3 — BGĐ duyệt báo giá NCC (card ở trang Dự án như P1.3)
  'P3.6': {
    sidebar: '/dashboard/projects',
    label: 'Dự án',
    hint: 'BGĐ mở dự án để duyệt báo giá nhà cung cấp (hoặc Từ chối kèm lý do).',
    mode: 'redirect',
    projectScoped: true,
  },
  // Phase 6 — BGĐ duyệt đóng dự án (card ở trang Dự án như P1.3)
  'P6.5': {
    sidebar: '/dashboard/projects',
    label: 'Dự án',
    hint: 'BGĐ mở dự án để duyệt đóng dự án (hoặc Từ chối kèm lý do).',
    mode: 'redirect',
    projectScoped: true,
  },

  // ── Phase 3 (làm) — redirect về sân từng phòng, làm ở tab rồi Hoàn thành ──
  'P3.1': { sidebar: '/dashboard/milestones', label: 'Cột mốc', hint: 'PM mở tab Cột mốc để điều chỉnh kế hoạch & đẩy tiến độ cấp hàng rồi hoàn thành.', mode: 'redirect', projectQuery: 'project' },
  'P3.3': { sidebar: '/dashboard/production', label: 'Sản xuất', hint: 'PM mở tab Sản xuất để lập lệnh SX cho thầu phụ + đề nghị cấp VT rồi hoàn thành.', mode: 'redirect', projectQuery: 'project' },
  'P3.4': { sidebar: '/dashboard/production', label: 'Sản xuất', hint: 'PM mở tab Sản xuất để lập lệnh sản xuất cho tổ nội bộ & thầu phụ rồi hoàn thành.', mode: 'redirect', projectQuery: 'project' },
  'P3.5': { sidebar: '/dashboard/warehouse/procurement', label: 'Mua hàng', hint: 'Thương mại mở tab Mua hàng để tìm NCC, nhập báo giá (biểu mẫu) rồi hoàn thành.', mode: 'redirect', projectQuery: 'project' },

  // ── Phase 4 (làm) ──
  'P4.5': { sidebar: '/dashboard/warehouse/material-issue', label: 'Cấp phát VT', hint: 'Kho mở tab Cấp phát vật tư để đề nghị cấp VT cho PM & QLSX rồi hoàn thành.', mode: 'redirect', projectQuery: 'project' },

  // ── Phase 5 (làm) ──
  'P5.1': { sidebar: '/dashboard/production', label: 'Sản xuất', hint: 'Tổ SX mở tab Sản xuất để báo cáo khối lượng nội bộ theo ngày rồi hoàn thành.', mode: 'redirect', projectQuery: 'project' },
  'P5.1A': { sidebar: '/dashboard/production', label: 'Sản xuất', hint: 'PM mở tab Sản xuất để báo cáo khối lượng thầu phụ theo ngày rồi hoàn thành.', mode: 'redirect', projectQuery: 'project' },
  'P5.1.1': { sidebar: '/dashboard/qc', label: 'Chất lượng', hint: 'Mở tab Chất lượng để yêu cầu nghiệm thu chất lượng hạng mục rồi hoàn thành.', mode: 'redirect', projectQuery: 'project' },
  'P5.3A': { sidebar: '/dashboard/qc', label: 'Chất lượng', hint: 'QAQC mở tab Chất lượng để nghiệm thu chất lượng hạng mục rồi hoàn thành.', mode: 'redirect', projectQuery: 'project' },
  'P5.2': { sidebar: '/dashboard/production', label: 'Sản xuất', hint: 'Tổ SX mở tab Sản xuất để báo cáo khối lượng hoàn thành theo tuần rồi hoàn thành.', mode: 'redirect', projectQuery: 'project' },
  'P5.3': { sidebar: '/dashboard/qc', label: 'Chất lượng', hint: 'QC mở tab Chất lượng để nghiệm thu khối lượng tuần rồi hoàn thành.', mode: 'redirect', projectQuery: 'project' },
  'P5.4': { sidebar: '/dashboard/qc', label: 'Chất lượng', hint: 'PM mở tab Chất lượng để nghiệm thu khối lượng tuần rồi hoàn thành.', mode: 'redirect', projectQuery: 'project' },
  'P5.5': { sidebar: '/dashboard/hr/piece-rate', label: 'Khoán lương', hint: 'KTKH mở tab Khoán lương để tổng hợp & tính lương khoán rồi hoàn thành.', mode: 'redirect', projectQuery: 'project' },

  // ── Phase 6 (làm) ──
  'P6.1': { sidebar: '/dashboard/qc', label: 'Chất lượng', hint: 'QC mở tab Chất lượng để tổng hợp hồ sơ chất lượng (Dossier) rồi hoàn thành.', mode: 'redirect', projectQuery: 'project' },
  'P6.2': { sidebar: '/dashboard/finance/settlement', label: 'Quyết toán', hint: 'Kế toán mở tab Quyết toán để quyết toán chi phí trực tiếp rồi hoàn thành.', mode: 'redirect', projectQuery: 'project' },
  'P6.3': { sidebar: '/dashboard/finance/settlement', label: 'Quyết toán', hint: 'KTKH mở tab Quyết toán để quyết toán tổng hợp (P&L) rồi hoàn thành.', mode: 'redirect', projectQuery: 'project' },
  'P6.4': { sidebar: '/dashboard/lessons', label: 'Bài học KN', hint: 'PM mở tab Bài học kinh nghiệm để tổ chức Lesson Learned rồi hoàn thành.', mode: 'redirect', projectQuery: 'project' },
}

export function isNotifyTask(taskType?: string | null): boolean {
  return !!taskType && taskType in NOTIFY_TASK_MAP
}

export function notifyTaskInfo(taskType?: string | null): NotifyTaskInfo | undefined {
  return taskType ? NOTIFY_TASK_MAP[taskType] : undefined
}
