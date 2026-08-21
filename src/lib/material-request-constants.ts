// Hằng số của phiếu đề nghị cấp vật tư — KHÔNG import prisma, để giao diện dùng chung được.
// (wo-materials.ts là server-only vì có prisma; client import từ đây.)

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
export const MR_EDITABLE: string[] = [MR_STATUS.DRAFT, MR_STATUS.REJECTED]

/** Vai trò được lập đề nghị: XƯỞNG tự lo vật tư cho lệnh của mình (PM chỉ phát hành WO). */
export const WO_MATERIAL_REQUEST_ROLES = ['R06', 'R06a', 'R06b']
