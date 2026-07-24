import { ROLES } from '@/lib/constants'

// Nhãn phụ phân biệt user (nhất là khi TRÙNG TÊN): "username · chức danh".
// username = tài khoản đăng nhập (thường là SĐT) → duy nhất tuyệt đối.
export function userDistinguisher(u: { username?: string | null; roleCode?: string | null }): string {
  const uname = u.username || ''
  const role = u.roleCode ? (ROLES as Record<string, { name: string }>)[u.roleCode]?.name || u.roleCode : ''
  return [uname, role].filter(Boolean).join(' · ')
}
