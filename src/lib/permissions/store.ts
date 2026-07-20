// ── Kho dữ liệu quyền (zero-schema) ──
// KHÔNG thêm bảng/cột nào. Dùng đúng thứ đã có:
//   • Role.permissions (Json)  → grant theo vai trò
//   • SystemConfig (key-value) → cấp bậc theo bước, chỉ định cá nhân, override user
// Tất cả đọc qua cache; ghi thì invalidate 'perm:*'.

// Server-only (dùng prisma). Client chỉ import catalog/bootstrap, không import file này.
import prisma from '../db'
import { withCache, cacheInvalidate } from '../cache'
import { roleCapabilitiesFromStatic } from './bootstrap'

const TTL = 300 // giây

// Khoá SystemConfig
const K_LEVELS = 'perm_step_levels'
const K_DESIGNATIONS = 'perm_designations'
const K_OVERRIDES = 'perm_overrides'

// ── Kiểu dữ liệu ──
export type Effect = 'ALLOW' | 'DENY'
export interface StepLevelRule { minLevel?: 1 | 2; requiresApproval?: boolean; approverLevel?: 1 | 2 }
export type StepLevels = Record<string, StepLevelRule>          // stepCode → rule
export type Designations = Record<string, string>              // `${projectId}:${stepCode}` → userId
export type OverrideMap = Record<string, Effect>               // capKey → effect
export type AllOverrides = Record<string, OverrideMap>         // userId → { cap → effect }

// Role.permissions khi ĐÃ cấu hình lưu shape này; nếu là mảng (seed `[]`) hoặc rỗng → coi như CHƯA cấu hình.
interface RoleGrantDoc { v: 1; caps: string[] }

// ── SystemConfig helpers ──
async function readConfig<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.systemConfig.findUnique({ where: { key } })
  if (!row?.value) return fallback
  try { return JSON.parse(row.value) as T } catch { return fallback }
}
async function writeConfig(key: string, value: unknown): Promise<void> {
  const str = JSON.stringify(value)
  await prisma.systemConfig.upsert({
    where: { key },
    update: { value: str },
    create: { key, value: str },
  })
}

// ── Grant theo vai trò (Role.permissions, fallback tĩnh) ──
function isConfigured(perm: unknown): perm is RoleGrantDoc {
  return !!perm && typeof perm === 'object' && !Array.isArray(perm) &&
    (perm as RoleGrantDoc).v === 1 && Array.isArray((perm as RoleGrantDoc).caps)
}

/** Tập capability của một vai trò: DB nếu đã cấu hình, ngược lại rơi về luật tĩnh. */
export async function getRoleGrants(roleCode: string): Promise<Set<string>> {
  const caps = await withCache<string[]>(`perm:role:${roleCode}`, TTL, async () => {
    const role = await prisma.role.findUnique({ where: { code: roleCode }, select: { permissions: true } })
    if (role && isConfigured(role.permissions)) return role.permissions.caps
    return [...roleCapabilitiesFromStatic(roleCode)]   // chưa cấu hình → giống hệt code cũ
  })
  return new Set(caps)
}

/** Lưu grant cho vai trò (ghi Role.permissions dạng {v,caps}). */
export async function setRoleGrants(roleCode: string, caps: string[]): Promise<void> {
  const doc: RoleGrantDoc = { v: 1, caps: [...new Set(caps)].sort() }
  await prisma.role.upsert({
    where: { code: roleCode },
    update: { permissions: doc as object },
    create: { code: roleCode, name: roleCode, permissions: doc as object },
  })
  await cacheInvalidate('perm:*')
}

/** Vai trò đã được cấu hình riêng trong DB chưa (để UI phân biệt "mặc định tĩnh" vs "đã chỉnh"). */
export async function isRoleConfigured(roleCode: string): Promise<boolean> {
  const role = await prisma.role.findUnique({ where: { code: roleCode }, select: { permissions: true } })
  return !!role && isConfigured(role.permissions)
}

// ── Cấp bậc theo bước ──
export async function getStepLevels(): Promise<StepLevels> {
  return withCache<StepLevels>('perm:levels', TTL, () => readConfig<StepLevels>(K_LEVELS, {}))
}
export async function setStepLevels(next: StepLevels): Promise<void> {
  await writeConfig(K_LEVELS, next)
  await cacheInvalidate('perm:*')
}

// ── Chỉ định cá nhân ──
export async function getDesignations(): Promise<Designations> {
  return withCache<Designations>('perm:designations', TTL, () => readConfig<Designations>(K_DESIGNATIONS, {}))
}
export async function setDesignations(next: Designations): Promise<void> {
  await writeConfig(K_DESIGNATIONS, next)
  await cacheInvalidate('perm:*')
}
/** Người được chỉ định phụ trách bước X của dự án Y (nếu có). */
export async function resolveDesignation(projectId: string, stepCode: string): Promise<string | null> {
  const all = await getDesignations()
  return all[`${projectId}:${stepCode}`] || null
}

// ── Override theo user ──
export async function getAllOverrides(): Promise<AllOverrides> {
  return withCache<AllOverrides>('perm:overrides', TTL, () => readConfig<AllOverrides>(K_OVERRIDES, {}))
}
export async function getUserOverrides(userId: string): Promise<OverrideMap> {
  const all = await getAllOverrides()
  return all[userId] || {}
}
/** Đặt lại toàn bộ override của MỘT user (map rỗng = xoá hết override của user đó). */
export async function setUserOverrides(userId: string, map: OverrideMap): Promise<void> {
  const all = await getAllOverrides()
  if (Object.keys(map).length === 0) delete all[userId]
  else all[userId] = map
  await writeConfig(K_OVERRIDES, all)
  await cacheInvalidate('perm:*')
}
