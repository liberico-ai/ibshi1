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

/** Xưởng nội bộ: tự lo vật tư cho lệnh của xưởng mình. */
export const WORKSHOP_MATERIAL_ROLES = ['R06', 'R06a', 'R06b']

/**
 * PM: lập đề nghị cho lệnh GIAO THẦU PHỤ — lệnh làm ngoài không thuộc xưởng nào nên
 * không ai trong xưởng đứng ra lo được. Chốt với nghiệp vụ 09/2026: thầu phụ do PM
 * phát hành WO và lập luôn đề nghị vật tư.
 */
export const PM_MATERIAL_ROLES = ['R02', 'R02a']

/** Mọi vai lập được đề nghị (còn lập cho lệnh NÀO thì xem canRequestMaterialForWo). */
export const WO_MATERIAL_REQUEST_ROLES = [...WORKSHOP_MATERIAL_ROLES, ...PM_MATERIAL_ROLES]

/** Mã tổ quy ước cho lệnh giao ngoài. */
export const SUBCONTRACT_TEAM_CODE = 'THAUPHU'

/**
 * Lệnh có phải giao thầu phụ không.
 *
 * KHÔNG suy từ việc thiếu departmentId: lệnh nội bộ nhập thiếu phòng cũng không có
 * departmentId, mà đó là lỗi dữ liệu chứ không phải giao ngoài. Chỉ căn cứ dấu hiệu
 * do người lập chủ động đặt: woType EXTERNAL hoặc tổ THAUPHU.
 */
export function isSubcontractWo(wo: { woType?: string | null; teamCode?: string | null }): boolean {
  return wo.woType === 'EXTERNAL' || (wo.teamCode || '').toUpperCase() === SUBCONTRACT_TEAM_CODE
}
