import prisma from './db'

// PM phụ trách dự án — NHIỀU người, NGANG QUYỀN nhau (chốt nghiệp vụ 2026-08).
//
// Bất kỳ PM nào trong danh sách cũng thao tác và hoàn thành việc của dự án được; KHÔNG cần
// cả nhóm cùng bấm xong. Vì vậy task vai R02 vẫn chỉ giao cho MỘT người (PM đầu mối) —
// luật "việc chỉ hoàn thành khi mọi người nhận đã xong" của hệ giữ nguyên, còn các PM khác
// vẫn làm được nhờ kiểm quyền theo danh sách này thay vì theo dòng người nhận.
//
// projects.pm_user_id giữ nguyên = PM ĐẦU MỐI (người nhận mặc định). Mọi nơi kiểm quyền
// phải gọi hàm ở đây, đừng so sánh thẳng pmUserId nữa.

/** Danh sách userId của mọi PM phụ trách dự án (gồm cả PM đầu mối, kể cả khi chưa có dòng trong project_pms). */
export async function getProjectPmIds(projectId: string): Promise<string[]> {
  const [rows, project] = await Promise.all([
    prisma.projectPm.findMany({ where: { projectId }, select: { userId: true } }),
    prisma.project.findUnique({ where: { id: projectId }, select: { pmUserId: true } }),
  ])
  const ids = new Set(rows.map(r => r.userId))
  if (project?.pmUserId) ids.add(project.pmUserId)   // phòng dự án cũ chưa kịp chép sang bảng mới
  return [...ids]
}

/** User này có phải PM phụ trách dự án không. */
export async function isProjectPm(userId: string, projectId: string | null | undefined): Promise<boolean> {
  if (!projectId || !userId) return false
  const found = await prisma.projectPm.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { id: true },
  })
  if (found) return true
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { pmUserId: true } })
  return !!p?.pmUserId && p.pmUserId === userId
}

/** Các dự án mà user đang phụ trách (dùng để lọc danh sách, hộp duyệt…). */
export async function getProjectIdsOfPm(userId: string): Promise<string[]> {
  const [rows, owned] = await Promise.all([
    prisma.projectPm.findMany({ where: { userId }, select: { projectId: true } }),
    prisma.project.findMany({ where: { pmUserId: userId }, select: { id: true } }),
  ])
  return [...new Set([...rows.map(r => r.projectId), ...owned.map(p => p.id)])]
}

/**
 * Quyền thao tác cấp DỰ ÁN (tạo/sửa WO, phát hành WO từ WBS…): PM phụ trách dự án + BGĐ.
 * Bản async thay cho canManageProjectWo cũ (so sánh 1 người).
 */
export async function canManageProject(roleCode: string, userId: string, projectId: string | null | undefined): Promise<boolean> {
  if (roleCode === 'R01') return true            // BGĐ toàn quyền
  return isProjectPm(userId, projectId)
}

/** Thông báo 403 chuẩn khi không phải PM phụ trách. */
export function notProjectPmMessage(hasAnyPm: boolean): string {
  return hasAnyPm
    ? 'Chỉ PM phụ trách dự án này (hoặc BGĐ) mới được thao tác lệnh sản xuất.'
    : 'Dự án chưa gán PM phụ trách — cần gán PM cho dự án trước khi tạo lệnh sản xuất.'
}
