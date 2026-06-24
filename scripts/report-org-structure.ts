/**
 * Báo cáo cơ cấu tổ chức — READ-ONLY, không ghi DB.
 *
 * Chạy: npx tsx scripts/report-org-structure.ts
 * Với DB prod: source .env.backup.production && npx tsx scripts/report-org-structure.ts
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { writeFileSync } from 'fs'
import path from 'path'

// ── Import code definitions ──
// Inline to avoid Next.js module resolution issues with tsx
const ROLES: Record<string, { code: string; name: string }> = {
  R01: { code: 'R01', name: 'Ban Giám đốc' },
  R02: { code: 'R02', name: 'Quản lý Dự án' },
  R02a: { code: 'R02a', name: 'Nhân viên Quản lý Dự án' },
  R03: { code: 'R03', name: 'Kinh tế Kế hoạch' },
  R03a: { code: 'R03a', name: 'Nhân viên Kinh tế Kế hoạch' },
  R04: { code: 'R04', name: 'Thiết kế' },
  R04a: { code: 'R04a', name: 'Nhân viên Thiết kế' },
  R05: { code: 'R05', name: 'Kho' },
  R05a: { code: 'R05a', name: 'Nhân viên Kho' },
  R06: { code: 'R06', name: 'Quản lý Sản xuất' },
  R06a: { code: 'R06a', name: 'Nhân viên Sản xuất' },
  R06b: { code: 'R06b', name: 'Tổ trưởng sản xuất' },
  R07: { code: 'R07', name: 'Thương mại' },
  R07a: { code: 'R07a', name: 'Nhân viên Thương mại' },
  R08: { code: 'R08', name: 'Kế toán' },
  R08a: { code: 'R08a', name: 'Nhân viên Kế toán' },
  R09: { code: 'R09', name: 'Chất lượng (QC)' },
  R09a: { code: 'R09a', name: 'Kiểm tra viên' },
  R10: { code: 'R10', name: 'Quản trị Hệ thống' },
  R11: { code: 'R11', name: 'Trưởng phòng Thiết bị & Cơ giới' },
}

const ROLE_TO_DEPT: Record<string, string> = {
  R01: 'BGD',
  R02: 'QLDA', R02a: 'QLDA',
  R03: 'KTKH', R03a: 'KTKH',
  R04: 'TK', R04a: 'TK',
  R05: 'TCKT', R05a: 'TCKT', R08: 'TCKT', R08a: 'TCKT',
  R06: 'SX', R06a: 'SX', R06b: 'SX',
  R07: 'TM', R07a: 'TM',
  R09: 'QC', R09a: 'QC',
  R10: 'CNTT',
  R11: 'TBCG',
}

const DEPT_NAME: Record<string, string> = {
  BGD: 'Ban Giám đốc',
  CNTT: 'CNTT & Dữ liệu',
  TK: 'Phòng Kỹ thuật',
  KTKH: 'Kinh tế Kế hoạch',
  TM: 'Thương mại',
  QLDA: 'Quản lý Dự án',
  SX: 'Sản xuất',
  TCKT: 'Tài chính Kế toán & Kho',
  QC: 'QA/QC',
  TBCG: 'Thiết bị & Cơ giới',
}

// ── Main ──

function createPrisma() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is required. Set it in .env or source .env.backup.production')
  }
  const isRemote = !connectionString.includes('@localhost') && !connectionString.includes('@127.0.0.1')
  const pool = new pg.Pool({
    connectionString,
    max: 3,
    connectionTimeoutMillis: 5000,
    ...(isRemote && { ssl: { rejectUnauthorized: false } }),
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- @types/pg version mismatch
  const adapter = new PrismaPg(pool as any)
  return new PrismaClient({ adapter })
}

const prisma = createPrisma()

interface UserRow {
  id: string
  username: string
  fullName: string
  roleCode: string
  isActive: boolean
  userLevel: number
  departmentId: string | null
}

async function main() {
  const lines: string[] = []
  const log = (s: string) => { console.log(s); lines.push(s) }

  log('# Báo cáo Cơ cấu Tổ chức — IBS ERP')
  log('')
  log(`Ngày xuất: ${new Date().toISOString().slice(0, 10)}`)
  log('')

  // ═══════════════════════════════════════════════════════════════
  // 1. ĐỊNH NGHĨA TỪ CODE
  // ═══════════════════════════════════════════════════════════════
  log('## 1. Định nghĩa từ code (ROLES + ROLE_TO_DEPT)')
  log('')
  log('| roleCode | Tên role | Phòng (DEPT_NAME) |')
  log('|----------|----------|-------------------|')
  for (const [code, role] of Object.entries(ROLES)) {
    const dept = ROLE_TO_DEPT[code]
    const deptName = dept ? DEPT_NAME[dept] || dept : '_(chưa ánh xạ)_'
    log(`| ${code} | ${role.name} | ${deptName} |`)
  }
  log('')

  // ═══════════════════════════════════════════════════════════════
  // 2. THỰC TẾ TỪ DB
  // ═══════════════════════════════════════════════════════════════
  log('## 2. Thực tế từ DB')
  log('')

  const users: UserRow[] = await prisma.user.findMany({
    select: { id: true, username: true, fullName: true, roleCode: true, isActive: true, userLevel: true, departmentId: true },
    orderBy: [{ roleCode: 'asc' }, { fullName: 'asc' }],
  })

  // 2a. Group by roleCode
  log('### 2a. Phân bố theo roleCode')
  log('')
  log('| roleCode | Tên role | Active | Inactive | Tổng |')
  log('|----------|----------|--------|----------|------|')

  const byRole = new Map<string, UserRow[]>()
  for (const u of users) {
    if (!byRole.has(u.roleCode)) byRole.set(u.roleCode, [])
    byRole.get(u.roleCode)!.push(u)
  }
  const sortedRoles = [...byRole.keys()].sort()
  for (const rc of sortedRoles) {
    const list = byRole.get(rc)!
    const active = list.filter(u => u.isActive).length
    const inactive = list.length - active
    const roleName = ROLES[rc]?.name || '_(không rõ)_'
    log(`| ${rc} | ${roleName} | ${active} | ${inactive} | ${list.length} |`)
  }
  log('')

  // 2b. Group by department (via ROLE_TO_DEPT)
  log('### 2b. Phân bố theo Phòng ban (ROLE_TO_DEPT)')
  log('')

  const byDept = new Map<string, UserRow[]>()
  for (const u of users) {
    const dept = ROLE_TO_DEPT[u.roleCode] || '_UNMAPPED_'
    if (!byDept.has(dept)) byDept.set(dept, [])
    byDept.get(dept)!.push(u)
  }

  const sortedDepts = [...byDept.keys()].sort()
  for (const dept of sortedDepts) {
    const list = byDept.get(dept)!
    const active = list.filter(u => u.isActive).length
    const deptLabel = DEPT_NAME[dept] || dept
    log(`#### ${deptLabel} (${dept}) — ${active} active / ${list.length} tổng`)
    log('')
    log('| roleCode | Họ tên | Username | Active | Level |')
    log('|----------|--------|----------|--------|-------|')
    for (const u of list) {
      log(`| ${u.roleCode} | ${u.fullName} | ${u.username} | ${u.isActive ? '✓' : '✗'} | ${u.userLevel} |`)
    }
    log('')
  }

  // 2c. Department table (from DB model)
  const dbDepts = await prisma.department.findMany({
    include: { _count: { select: { employees: true, users: true } } },
    orderBy: { code: 'asc' },
  })
  if (dbDepts.length > 0) {
    log('### 2c. Phòng ban từ DB (model Department)')
    log('')
    log('| Code | Tên | Số NV (Employee) | Số User |')
    log('|------|-----|------------------|---------|')
    for (const d of dbDepts) {
      log(`| ${d.code} | ${d.name} | ${d._count.employees} | ${d._count.users} |`)
    }
    log('')
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. ĐỐI CHIẾU
  // ═══════════════════════════════════════════════════════════════
  log('## 3. Đối chiếu & phát hiện')
  log('')

  // 3a. Role mồ côi (có user nhưng không có trong ROLES)
  const orphanRoles = sortedRoles.filter(rc => !(rc in ROLES))
  log(`### 3a. Role "mồ côi" (có user, không trong ROLES): ${orphanRoles.length}`)
  if (orphanRoles.length > 0) {
    for (const rc of orphanRoles) {
      const count = byRole.get(rc)!.length
      log(`- \`${rc}\` — ${count} user`)
    }
  } else {
    log('_(không có)_')
  }
  log('')

  // 3b. Role defined but 0 users
  const emptyRoles = Object.keys(ROLES).filter(rc => !byRole.has(rc))
  log(`### 3b. Role định nghĩa nhưng 0 user: ${emptyRoles.length}`)
  if (emptyRoles.length > 0) {
    log(emptyRoles.map(rc => `\`${rc}\``).join(', '))
  } else {
    log('_(không có)_')
  }
  log('')

  // 3c. Inactive users
  const inactive = users.filter(u => !u.isActive)
  log(`### 3c. User inactive (isActive=false): ${inactive.length}`)
  if (inactive.length > 0) {
    log('')
    log('| roleCode | Họ tên | Username |')
    log('|----------|--------|----------|')
    for (const u of inactive) {
      log(`| ${u.roleCode} | ${u.fullName} | ${u.username} |`)
    }
  }
  log('')

  // 3d. Dept without head (userLevel=1)
  log('### 3d. Phòng ban không có trưởng phòng (userLevel=1)')
  const deptsWithHead = new Set<string>()
  for (const u of users) {
    if (u.isActive && u.userLevel === 1) {
      const dept = ROLE_TO_DEPT[u.roleCode]
      if (dept) deptsWithHead.add(dept)
    }
  }
  const deptsNoHead = Object.keys(DEPT_NAME).filter(d => !deptsWithHead.has(d))
  if (deptsNoHead.length > 0) {
    for (const d of deptsNoHead) {
      log(`- ${DEPT_NAME[d]} (${d})`)
    }
  } else {
    log('_(tất cả đều có trưởng phòng)_')
  }
  log('')

  // 3e. Duplicate fullName
  log('### 3e. Trùng tên thật (fullName) giữa các user')
  const nameMap = new Map<string, UserRow[]>()
  for (const u of users) {
    if (!nameMap.has(u.fullName)) nameMap.set(u.fullName, [])
    nameMap.get(u.fullName)!.push(u)
  }
  const dupes = [...nameMap.entries()].filter(([, list]) => list.length > 1)
  if (dupes.length > 0) {
    log('')
    log('| Tên | Số TK | Roles | Usernames |')
    log('|-----|-------|-------|-----------|')
    for (const [name, list] of dupes) {
      const roles = [...new Set(list.map(u => u.roleCode))].join(', ')
      const unames = list.map(u => `${u.username}${u.isActive ? '' : ' (off)'}`).join(', ')
      log(`| ${name} | ${list.length} | ${roles} | ${unames} |`)
    }
  } else {
    log('_(không có)_')
  }
  log('')

  // ═══════════════════════════════════════════════════════════════
  // 4. TỔNG HỢP
  // ═══════════════════════════════════════════════════════════════
  log('## 4. Tổng hợp')
  log('')

  const totalActive = users.filter(u => u.isActive).length
  const totalInactive = users.length - totalActive
  const usedRoleCount = sortedRoles.length
  const usedDeptCount = sortedDepts.filter(d => d !== '_UNMAPPED_').length

  log(`| Chỉ số | Giá trị |`)
  log(`|--------|---------|`)
  log(`| Tổng user | ${users.length} |`)
  log(`| User active | ${totalActive} |`)
  log(`| User inactive | ${totalInactive} |`)
  log(`| Số role đang dùng | ${usedRoleCount} |`)
  log(`| Số phòng ban (ROLE_TO_DEPT) | ${usedDeptCount} |`)
  log('')

  log('### Phân bố user active theo phòng')
  log('')
  log('| Phòng | Active | % |')
  log('|-------|--------|---|')
  for (const dept of sortedDepts) {
    const list = byDept.get(dept)!.filter(u => u.isActive)
    const pct = totalActive > 0 ? ((list.length / totalActive) * 100).toFixed(1) : '0.0'
    const deptLabel = DEPT_NAME[dept] || dept
    log(`| ${deptLabel} | ${list.length} | ${pct}% |`)
  }
  log('')

  // ── Write to file ──
  const outPath = path.join(process.cwd(), 'docs', 'BAO_CAO_CO_CAU_TO_CHUC.md')
  writeFileSync(outPath, lines.join('\n'), 'utf-8')
  console.log(`\n✅ Đã ghi file: ${outPath}`)
}

main()
  .catch((err) => { console.error('Error:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
