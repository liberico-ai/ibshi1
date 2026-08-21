// Hằng số trạng thái phiếu đề nghị cấp vật tư — TÁCH RIÊNG khỏi wo-materials.ts để client
// component (WoMaterialRequestModal) dùng được mà KHÔNG kéo theo `@/lib/db` (prisma+pg) vào
// bundle browser (gây "Module not found: dns/fs/net" → sập toàn app). Chỉ chứa giá trị thuần.
export const MR_STATUS = {
  DRAFT: 'DRAFT',             // xưởng đang lập, chưa gửi
  PENDING_PM: 'PENDING_PM',   // chờ PM phụ trách dự án duyệt
  PENDING_BOD: 'PENDING_BOD', // PM duyệt rồi, chờ BGĐ
  APPROVED: 'APPROVED',       // đủ 2 chữ ký → Kho mới thấy
  REJECTED: 'REJECTED',       // bị trả lại, xưởng sửa rồi gửi lại
} as const

export const MR_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Nháp', PENDING_PM: 'Chờ PM duyệt', PENDING_BOD: 'Chờ BGĐ duyệt',
  APPROVED: 'Đã duyệt', REJECTED: 'Bị trả lại',
}

/** Phiếu đang sửa được (xưởng): nháp hoặc bị trả lại. */
export const MR_EDITABLE = [MR_STATUS.DRAFT, MR_STATUS.REJECTED] as string[]
