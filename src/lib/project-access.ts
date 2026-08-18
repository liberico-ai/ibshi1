// Quyền thao tác cấp DỰ ÁN (Tạo WO, phân giao SX…): chỉ PM PHỤ TRÁCH dự án đó (+ BGĐ toàn quyền).
// Dự án chưa gán PM (pmUserId null) → chỉ BGĐ; R02 phải được gán làm PM dự án mới thao tác được.
export function canManageProjectWo(roleCode: string, userId: string, pmUserId: string | null | undefined): boolean {
  if (roleCode === 'R01') return true // BGĐ
  return !!pmUserId && pmUserId === userId // đúng PM phụ trách
}

// Thông báo lỗi 403 chuẩn khi không phải PM phụ trách.
export function notProjectPmError(pmUserId: string | null | undefined): string {
  return pmUserId
    ? 'Chỉ PM phụ trách dự án này (hoặc BGĐ) mới được thao tác lệnh sản xuất.'
    : 'Dự án chưa gán PM phụ trách — cần gán PM cho dự án trước khi tạo lệnh sản xuất.'
}
