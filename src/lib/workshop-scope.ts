import prisma from './db'
import { WORKSHOP_MATERIAL_ROLES } from './material-request-constants'

// ─────────────────────────────────────────────────────────────────────────────
// Xưởng nào chỉ thấy việc của xưởng đó (chốt 09/2026).
//
// Khai MỘT chỗ để màn Sản xuất và màn Phiếu công việc không bao giờ lệch nhau — trước đây
// mỗi màn tự lọc một kiểu, thành ra danh sách lệnh đã siết mà danh sách phiếu vẫn hở.
//
// Khớp theo departmentId HOẶC teamCode: nhiều lệnh cũ ghi đúng mã xưởng ở teamCode nhưng
// chưa nối khoá phòng. Chỉ soi departmentId thì xưởng mất lệnh của mình; chỉ soi teamCode
// thì lệnh mới lại hụt.
// ─────────────────────────────────────────────────────────────────────────────

/** Vai bị giới hạn theo xưởng: quản đốc, nhân viên, tổ trưởng. BGĐ/PM/KTKH/Admin thấy hết. */
export const WORKSHOP_SCOPED_ROLES: string[] = WORKSHOP_MATERIAL_ROLES

export interface WorkshopScope {
  /** Phòng của tài khoản — null khi người xem không bị giới hạn, hoặc chưa gắn phòng. */
  scope: { departmentId: string; code: string; name: string } | null
  /** Tài khoản thuộc vai xưởng nhưng chưa gắn phòng → không cho thấy gì, giao diện nhắc gắn. */
  scopeMissing: boolean
  /** Điều kiện lọc trên bảng WorkOrder; null = không giới hạn. */
  woWhere: Record<string, unknown> | null
}

/** Không khớp gì cả — dùng khi tài khoản xưởng chưa gắn phòng (im lặng cho thấy hết là hở quyền). */
const MATCH_NOTHING = { id: { in: [] as string[] } }

export async function getWorkshopScope(userId: string, roleCode: string): Promise<WorkshopScope> {
  if (!WORKSHOP_SCOPED_ROLES.includes(roleCode)) {
    return { scope: null, scopeMissing: false, woWhere: null }
  }
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { department: { select: { id: true, code: true, name: true } } },
  })
  if (!me?.department) return { scope: null, scopeMissing: true, woWhere: MATCH_NOTHING }

  const d = me.department
  return {
    scope: { departmentId: d.id, code: d.code, name: d.name },
    scopeMissing: false,
    woWhere: { OR: [{ departmentId: d.id }, { teamCode: d.code }] },
  }
}
