export const STATUS_COLORS = {
  task: {
    OPEN:             { bg: '#F1F3F5', text: '#64748B', label: 'Mở' },
    IN_PROGRESS:      { bg: '#E8F0FA', text: '#2D6CB5', label: 'Đang thực hiện' },
    BLOCKED:          { bg: '#FFF7ED', text: '#C2410C', label: 'Bị chặn' },
    AWAITING_REVIEW:  { bg: '#FBF1DF', text: '#C97A0E', label: 'Chờ duyệt' },
    RETURNED:         { bg: '#FDECEA', text: '#C8372B', label: 'Trả lại' },
    DONE:             { bg: '#E6F4EC', text: '#1E8E5A', label: 'Hoàn thành' },
    CANCELLED:        { bg: '#F1F3F5', text: '#9AA0A8', label: 'Huỷ' },
  },
  po: {
    DRAFT:            { bg: '#F1F3F5', text: '#64748B', label: 'Nháp' },
    PENDING:          { bg: '#FBF1DF', text: '#C97A0E', label: 'Chờ duyệt' },
    APPROVED:         { bg: '#E6F4EC', text: '#1E8E5A', label: 'Đã duyệt' },
    SENT:             { bg: '#E8F0FA', text: '#2D6CB5', label: 'Đã gửi' },
    PROCESSING_PAYMENT: { bg: '#FBF1DF', text: '#C97A0E', label: 'Đang thanh toán' },
    PAID:             { bg: '#E6FFFE', text: '#0E8C8C', label: 'Đã thanh toán' },
    PARTIAL_RECEIVED: { bg: '#FFF7ED', text: '#C2410C', label: 'Nhận một phần' },
    RECEIVED:         { bg: '#E8F0FA', text: '#2D6CB5', label: 'Đã nhận' },
    COMPLETED:        { bg: '#E6F4EC', text: '#157347', label: 'Hoàn tất' },
  },
  revision: {
    DRAFT:            { bg: '#F1F3F5', text: '#64748B', label: 'Nháp' },
    ISSUED:           { bg: '#E6F4EC', text: '#1E8E5A', label: 'Đã phát hành' },
    SUPERSEDED:       { bg: '#F1F3F5', text: '#9AA0A8', label: 'Thay thế' },
  },
  ncr: {
    OPEN:             { bg: '#FDECEA', text: '#C8372B', label: 'Mở' },
    INVESTIGATING:    { bg: '#FBF1DF', text: '#C97A0E', label: 'Đang xử lý' },
    ACTION_TAKEN:     { bg: '#E8F0FA', text: '#2D6CB5', label: 'Đã xử lý' },
    CLOSED:           { bg: '#E6F4EC', text: '#1E8E5A', label: 'Đóng' },
    CANCELLED:        { bg: '#F1F3F5', text: '#9AA0A8', label: 'Hủy' },
  },
  payment: {
    PENDING:           { bg: '#F1F3F5', text: '#64748B', label: 'Pending' },
    PAYMENT_REQUESTED: { bg: '#FBF1DF', text: '#C97A0E', label: 'Đã yêu cầu' },
    PAID:              { bg: '#E6F4EC', text: '#1E8E5A', label: 'Đã thanh toán' },
  },
  production: {
    OPEN:             { bg: '#F1F3F5', text: '#64748B', label: 'Chờ' },
    IN_PROGRESS:      { bg: '#E8F0FA', text: '#2D6CB5', label: 'Đang chạy' },
    PENDING_MATERIAL: { bg: '#FBF1DF', text: '#C97A0E', label: 'Chờ vật tư' },
    QC_PENDING:       { bg: '#FBF1DF', text: '#C97A0E', label: 'Chờ QC' },
    QC_PASSED:        { bg: '#E6F4EC', text: '#1E8E5A', label: 'QC đạt' },
    QC_FAILED:        { bg: '#FDECEA', text: '#C8372B', label: 'QC không đạt' },
    ON_HOLD:          { bg: '#F3F0FF', text: '#7C3AED', label: 'Tạm dừng' },
    COMPLETED:        { bg: '#E6F4EC', text: '#1E8E5A', label: 'Hoàn thành' },
    CANCELLED:        { bg: '#FDECEA', text: '#C8372B', label: 'Đã hủy' },
  },
  jobCard: {
    OPEN:             { bg: '#F1F3F5', text: '#64748B', label: 'Chờ' },
    IN_PROGRESS:      { bg: '#E8F0FA', text: '#2D6CB5', label: 'Đang làm' },
    COMPLETED:        { bg: '#E6F4EC', text: '#1E8E5A', label: 'Xong' },
    CANCELLED:        { bg: '#FDECEA', text: '#C8372B', label: 'Hủy' },
  },
  drawing: {
    IFR:              { bg: '#F1F3F5', text: '#64748B', label: 'Chờ duyệt' },
    IFC:              { bg: '#E8F0FA', text: '#2D6CB5', label: 'Thi công' },
    AFC:              { bg: '#E6F4EC', text: '#1E8E5A', label: 'Hoàn công' },
  },
  qc: {
    PENDING:          { bg: '#F1F3F5', text: '#64748B', label: 'Chờ kiểm' },
    PASSED:           { bg: '#E6F4EC', text: '#1E8E5A', label: 'Đạt' },
    FAILED:           { bg: '#FDECEA', text: '#C8372B', label: 'Không đạt' },
    CONDITIONAL:      { bg: '#FBF1DF', text: '#C97A0E', label: 'Đạt ĐK' },
  },
  itp: {
    DRAFT:            { bg: '#F1F3F5', text: '#64748B', label: 'Nháp' },
    APPROVED:         { bg: '#E6F4EC', text: '#1E8E5A', label: 'Đã duyệt' },
    IN_PROGRESS:      { bg: '#E8F0FA', text: '#2D6CB5', label: 'Đang kiểm' },
    COMPLETED:        { bg: '#E6F4EC', text: '#157347', label: 'Hoàn thành' },
  },
  logistics: {
    DRAFT:            { bg: '#F1F3F5', text: '#64748B', label: 'Nháp' },
    SHIPPED:          { bg: '#E8F0FA', text: '#2D6CB5', label: 'Đã xuất' },
    PENDING:          { bg: '#FBF1DF', text: '#C97A0E', label: 'Chờ xuất' },
    IN_TRANSIT:       { bg: '#E8F0FA', text: '#2D6CB5', label: 'Đang VC' },
    ARRIVED:          { bg: '#FFF7ED', text: '#C2410C', label: 'Đã tới' },
    RECEIVED:         { bg: '#E6F4EC', text: '#1E8E5A', label: 'Đã nhận' },
  },
  equipment: {
    AVAILABLE:        { bg: '#E6F4EC', text: '#1E8E5A', label: 'Sẵn sàng' },
    IN_USE:           { bg: '#E8F0FA', text: '#2D6CB5', label: 'Đang dùng' },
    MAINTENANCE:      { bg: '#FBF1DF', text: '#C97A0E', label: 'Bảo trì' },
    RETIRED:          { bg: '#F1F3F5', text: '#9AA0A8', label: 'Thanh lý' },
  },
  maintenance: {
    SCHEDULED:        { bg: '#F1F3F5', text: '#64748B', label: 'Lên lịch' },
    IN_PROGRESS:      { bg: '#E8F0FA', text: '#2D6CB5', label: 'Đang làm' },
    COMPLETED:        { bg: '#E6F4EC', text: '#1E8E5A', label: 'Xong' },
    CANCELLED:        { bg: '#FDECEA', text: '#C8372B', label: 'Hủy' },
  },
  permit: {
    DRAFT:            { bg: '#F1F3F5', text: '#64748B', label: 'Nháp' },
    PENDING:          { bg: '#FBF1DF', text: '#C97A0E', label: 'Chờ duyệt' },
    APPROVED:         { bg: '#E6F4EC', text: '#1E8E5A', label: 'Đã duyệt' },
    ACTIVE:           { bg: '#E8F0FA', text: '#2D6CB5', label: 'Hiệu lực' },
    CLOSED:           { bg: '#F1F3F5', text: '#9AA0A8', label: 'Đóng' },
    REJECTED:         { bg: '#FDECEA', text: '#C8372B', label: 'Từ chối' },
  },
  incident: {
    OPEN:             { bg: '#FDECEA', text: '#C8372B', label: 'Mở' },
    INVESTIGATING:    { bg: '#FBF1DF', text: '#C97A0E', label: 'Đang ĐT' },
    ACTION_TAKEN:     { bg: '#E8F0FA', text: '#2D6CB5', label: 'Đã XL' },
    CLOSED:           { bg: '#E6F4EC', text: '#1E8E5A', label: 'Đóng' },
  },
  bom: {
    DRAFT:            { bg: '#F1F3F5', text: '#64748B', label: 'Nháp' },
    APPROVED:         { bg: '#E6F4EC', text: '#1E8E5A', label: 'Đã duyệt' },
    RELEASED:         { bg: '#E8F0FA', text: '#2D6CB5', label: 'Phát hành' },
  },
  eco: {
    DRAFT:            { bg: '#F1F3F5', text: '#64748B', label: 'Nháp' },
    SUBMITTED:        { bg: '#FBF1DF', text: '#C97A0E', label: 'Đã gửi' },
    APPROVED:         { bg: '#E6F4EC', text: '#1E8E5A', label: 'Đã duyệt' },
    REJECTED:         { bg: '#FDECEA', text: '#C8372B', label: 'Từ chối' },
    IMPLEMENTED:      { bg: '#E8F0FA', text: '#2D6CB5', label: 'Đã áp dụng' },
  },
  flag: {
    overdue:          { bg: '#FDECEA', text: '#C8372B', label: 'Quá hạn' },
    escalated:        { bg: '#FDECEA', text: '#E1251B', label: 'Leo thang' },
    blocked:          { bg: '#FFF7ED', text: '#C2410C', label: 'Bị chặn' },
  },
} as const

export type StatusCategory = keyof typeof STATUS_COLORS
export type TaskStatusKey = keyof typeof STATUS_COLORS.task
export type POStatusKey = keyof typeof STATUS_COLORS.po

export const SEMANTIC_COLORS = {
  success: { solid: '#1E8E5A', bg: '#E6F4EC' },
  warning: { solid: '#C97A0E', bg: '#FBF1DF' },
  danger:  { solid: '#C8372B', bg: '#FDECEA' },
  info:    { solid: '#2D6CB5', bg: '#E8F0FA' },
  neutral: { solid: '#64748B', bg: '#F1F3F5' },
} as const

export const BRAND = {
  red:     '#E1251B',
  redHover:'#C01D14',
  redBg:   '#FDECEA',
  ink:     '#17191D',
  navy:    '#0a2540',
} as const
