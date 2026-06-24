/**
 * READ-ONLY: Đề xuất quy hoạch phòng ban trên prod.
 * KHÔNG ghi DB, KHÔNG sửa schema.
 *
 * npx tsx scripts/rebuild-plan-proposal.ts
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

// ── Target 10 office departments ──

const TARGET_DEPTS: Record<string, string> = {
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
const TARGET_CODES = new Set(Object.keys(TARGET_DEPTS))

// ── Role → Office dept mapping (R13 for TBCG head, R11 = deactivate) ──

const ROLE_MAP: Record<string, string> = {
  R01: 'BGD',
  R10: 'CNTT',
  R04: 'TK', R04a: 'TK',
  R03: 'KTKH', R03a: 'KTKH',
  R07: 'TM', R07a: 'TM',
  R02: 'QLDA', R02a: 'QLDA',
  R06: 'SX', R06a: 'SX', R06b: 'SX',
  R08: 'TCKT', R08a: 'TCKT', R05: 'TCKT', R05a: 'TCKT',
  R09: 'QC', R09a: 'QC',
  R13: 'TBCG',
}

const DEACTIVATE_ROLES = new Set(['R11'])
const SKIP_ROLES = new Set(['R12'])

// ── DB ──

function createPrisma() {
  const cs = process.env.DATABASE_URL
  if (!cs) throw new Error('DATABASE_URL required')
  const isRemote = !cs.includes('@localhost') && !cs.includes('@127.0.0.1')
  const pool = new pg.Pool({
    connectionString: cs, max: 3, connectionTimeoutMillis: 5000,
    ...(isRemote && { ssl: { rejectUnauthorized: false } }),
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PrismaClient({ adapter: new PrismaPg(pool as any) })
}

// ── Main ──

async function main() {
  const prisma = createPrisma()
  const log = (s: string) => console.log(s)

  log('╔══════════════════════════════════════════════════════════════╗')
  log('║  ĐỀ XUẤT QUY HOẠCH PHÒNG BAN — READ-ONLY                  ║')
  log('╚══════════════════════════════════════════════════════════════╝\n')

  // ── Fetch all data ──

  const users = await prisma.user.findMany({
    select: { id: true, username: true, fullName: true, roleCode: true,
              departmentId: true, isActive: true, userLevel: true },
    orderBy: [{ roleCode: 'asc' }, { fullName: 'asc' }],
  })

  const depts = await prisma.department.findMany({
    include: { _count: { select: { users: true, employees: true } } },
    orderBy: { code: 'asc' },
  })
  const deptById = new Map(depts.map(d => [d.id, d]))
  const deptByCode = new Map(depts.map(d => [d.code, d]))

  const dbRoles = await prisma.role.findMany({ orderBy: { code: 'asc' } })
  const dbRoleMap = new Map(dbRoles.map(r => [r.code, r]))

  // ════════════════════════════════════════════════════════
  // A. PHÂN LOẠI USER THEO ROLE
  // ════════════════════════════════════════════════════════

  log('═══════════════════════════════════════════════════')
  log('A. PHÂN LOẠI USER THEO ROLE')
  log('═══════════════════════════════════════════════════\n')

  const reassignUsers: { user: typeof users[0]; fromDept: string; toDept: string }[] = []
  const deactivateUsers: typeof users[0][] = []
  const skipUsers: typeof users[0][] = []
  const unmappedRoleUsers = new Map<string, typeof users[0][]>()
  const specialMoves: string[] = []

  for (const u of users) {
    const rc = u.roleCode

    if (DEACTIVATE_ROLES.has(rc)) {
      deactivateUsers.push(u)
      continue
    }

    if (SKIP_ROLES.has(rc)) {
      skipUsers.push(u)
      continue
    }

    const targetDept = ROLE_MAP[rc]
    if (!targetDept) {
      if (!unmappedRoleUsers.has(rc)) unmappedRoleUsers.set(rc, [])
      unmappedRoleUsers.get(rc)!.push(u)
      continue
    }

    const currentDept = u.departmentId ? deptById.get(u.departmentId) : null
    if (!currentDept || currentDept.code !== targetDept) {
      reassignUsers.push({
        user: u,
        fromDept: currentDept?.code || '(none)',
        toDept: targetDept,
      })
    }
  }

  // Trần Sỹ Mạnh special case
  const manh = users.find(u => u.username === 'manhtv')
  if (manh) {
    const manhDept = manh.departmentId ? deptById.get(manh.departmentId) : null
    specialMoves.push(
      `Trần Sỹ Mạnh (manhtv): role ${manh.roleCode}→R13, dept ${manhDept?.code || '(none)'}→TBCG`
    )
  }

  // ── A1: Mapped users needing reassign ──
  log(`### A1. User cần reassign dept (role đã map): ${reassignUsers.length}\n`)
  if (reassignUsers.length > 0) {
    log('| # | Họ tên | Username | Role | Từ dept | → Dept |')
    log('|---|--------|----------|------|---------|--------|')
    reassignUsers.forEach((r, i) => {
      log(`| ${i + 1} | ${r.user.fullName} | ${r.user.username} | ${r.user.roleCode} | ${r.fromDept} | ${r.toDept} |`)
    })
  }
  log('')

  // ── A2: Deactivate R11 ──
  log(`### A2. User R11 sẽ VÔ HIỆU HOÁ (isActive=false, gỡ dept): ${deactivateUsers.length}\n`)
  if (deactivateUsers.length > 0) {
    log('| # | Họ tên | Username | Dept hiện tại | Active | Level |')
    log('|---|--------|----------|---------------|--------|-------|')
    deactivateUsers.forEach((u, i) => {
      const d = u.departmentId ? deptById.get(u.departmentId) : null
      log(`| ${i + 1} | ${u.fullName} | ${u.username} | ${d?.code || '(none)'} (${d?.name || ''}) | ${u.isActive ? '✓' : '✗'} | ${u.userLevel} |`)
    })
  }
  log('')

  // ── A3: Skip R12 ──
  log(`### A3. User R12 (EPC) — để nguyên: ${skipUsers.length}\n`)
  if (skipUsers.length > 0) {
    log('| Họ tên | Username | Dept |')
    log('|--------|----------|------|')
    skipUsers.forEach(u => {
      const d = u.departmentId ? deptById.get(u.departmentId) : null
      log(`| ${u.fullName} | ${u.username} | ${d?.code || '(none)'} |`)
    })
  } else {
    log('_(R12 = 0 user)_')
  }
  log('')

  // ── A4: Unmapped roles ──
  log(`### A4. ⚠ CẢNH BÁO: Role CÓ user nhưng CHƯA MAP: ${unmappedRoleUsers.size}\n`)
  if (unmappedRoleUsers.size > 0) {
    for (const [rc, uList] of [...unmappedRoleUsers.entries()].sort()) {
      const dbRole = dbRoleMap.get(rc)
      log(`#### ⚠ ${rc} — "${dbRole?.name || '?'}" — ${uList.length} user\n`)
      log('| Họ tên | Username | Dept hiện tại | Active |')
      log('|--------|----------|---------------|--------|')
      for (const u of uList) {
        const d = u.departmentId ? deptById.get(u.departmentId) : null
        log(`| ${u.fullName} | ${u.username} | ${d?.code || '(none)'} | ${u.isActive ? '✓' : '✗'} |`)
      }
      log('')
    }
  } else {
    log('_(không có)_')
    log('')
  }

  // ── A5: Special: Trần Sỹ Mạnh ──
  log('### A5. Trần Sỹ Mạnh → R13 + TBCG\n')
  if (manh) {
    const manhDept = manh.departmentId ? deptById.get(manh.departmentId) : null
    log(`| Field | Hiện tại | Đề xuất |`)
    log(`|-------|---------|---------|`)
    log(`| fullName | ${manh.fullName} | (giữ) |`)
    log(`| username | ${manh.username} | (giữ) |`)
    log(`| roleCode | ${manh.roleCode} (${dbRoleMap.get(manh.roleCode)?.name}) | R13 (Trưởng phòng Thiết bị & Cơ giới) |`)
    log(`| dept | ${manhDept?.code || '(none)'} (${manhDept?.name || ''}) | TBCG (Thiết bị & Cơ giới) |`)
    log(`| userLevel | ${manh.userLevel} | 1 |`)
    log(`| isActive | ${manh.isActive} | true |`)
  } else {
    log('⚠ Không tìm thấy user manhtv trên DB!')
  }
  log('')

  // ════════════════════════════════════════════════════════
  // B. PHÂN LOẠI 45 DEPARTMENT
  // ════════════════════════════════════════════════════════

  log('═══════════════════════════════════════════════════')
  log('B. PHÂN LOẠI DEPARTMENT')
  log('═══════════════════════════════════════════════════\n')

  // Simulate reassign: count how many users each dept would lose/keep
  // Build a map: deptId → set of user IDs that will be reassigned away
  const reassignAwayFromDept = new Map<string, Set<string>>()
  for (const r of reassignUsers) {
    const deptId = r.user.departmentId
    if (deptId) {
      if (!reassignAwayFromDept.has(deptId)) reassignAwayFromDept.set(deptId, new Set())
      reassignAwayFromDept.get(deptId)!.add(r.user.id)
    }
  }
  // Also deactivated users leave their dept
  for (const u of deactivateUsers) {
    if (u.departmentId) {
      if (!reassignAwayFromDept.has(u.departmentId)) reassignAwayFromDept.set(u.departmentId, new Set())
      reassignAwayFromDept.get(u.departmentId)!.add(u.id)
    }
  }

  type DeptAction = 'GIỮ (target)' | 'TỔ CON → parent SX' | 'XOÁ (0 user sau reassign)' | '⚠ CÒN USER' | 'XOÁ (0 user hiện tại)'
  const deptPlan: { dept: typeof depts[0]; action: DeptAction; usersAfter: number; note: string }[] = []

  const warnings: string[] = []

  for (const d of depts) {
    const isTarget = TARGET_CODES.has(d.code)
    const isToCrew = d.code.startsWith('TO-')
    const currentUsers = d._count.users
    const leavingCount = reassignAwayFromDept.get(d.id)?.size || 0
    const usersAfter = currentUsers - leavingCount

    if (isTarget) {
      deptPlan.push({ dept: d, action: 'GIỮ (target)', usersAfter: -1, note: TARGET_DEPTS[d.code] })
    } else if (isToCrew) {
      if (currentUsers === 0) {
        deptPlan.push({ dept: d, action: 'XOÁ (0 user hiện tại)', usersAfter: 0, note: 'Tổ SX trống' })
        warnings.push(`TO- trống: ${d.code} "${d.name}" — 0 user → đề xuất XOÁ`)
      } else {
        deptPlan.push({ dept: d, action: 'TỔ CON → parent SX', usersAfter: currentUsers, note: `${currentUsers} user giữ nguyên` })
      }
    } else {
      // Office/legacy dept
      if (usersAfter <= 0) {
        deptPlan.push({ dept: d, action: 'XOÁ (0 user sau reassign)', usersAfter: 0, note: `${currentUsers}→0 sau reassign` })
      } else {
        deptPlan.push({ dept: d, action: '⚠ CÒN USER', usersAfter, note: `${currentUsers}→${usersAfter} sau reassign` })
        // List who stays
        const staying = users.filter(u => u.departmentId === d.id &&
          !reassignAwayFromDept.get(d.id)?.has(u.id))
        const stayList = staying.map(u => `${u.fullName} (${u.username}, ${u.roleCode})`).join('; ')
        warnings.push(`⚠ ${d.code} "${d.name}": ${usersAfter} user còn lại sau reassign: ${stayList}`)
      }
    }
  }

  // Print table
  log('| # | Code | Tên | User hiện | User sau | Hành động | Ghi chú |')
  log('|---|------|-----|-----------|----------|-----------|---------|')
  deptPlan.forEach((p, i) => {
    const after = p.usersAfter < 0 ? '—' : String(p.usersAfter)
    log(`| ${i + 1} | ${p.dept.code} | ${p.dept.name} | ${p.dept._count.users} | ${after} | ${p.action} | ${p.note} |`)
  })
  log('')

  // ════════════════════════════════════════════════════════
  // C. DANH SÁCH TỔ SX (TO-*) → CON CỦA SX
  // ════════════════════════════════════════════════════════

  log('═══════════════════════════════════════════════════')
  log('C. TỔ SẢN XUẤT (TO-*) → parentId = SX')
  log('═══════════════════════════════════════════════════\n')

  const toDepts = depts.filter(d => d.code.startsWith('TO-'))
  log('| Code | Tên | Users | Hành động |')
  log('|------|-----|-------|-----------|')
  for (const d of toDepts) {
    const action = d._count.users > 0 ? 'GIỮ, set parent=SX' : 'XOÁ (trống)'
    log(`| ${d.code} | ${d.name} | ${d._count.users} | ${action} |`)
  }
  log('')

  // ════════════════════════════════════════════════════════
  // D. KIỂM TRA SCHEMA: Department.parentId
  // ════════════════════════════════════════════════════════

  log('═══════════════════════════════════════════════════')
  log('D. KIỂM TRA SCHEMA: Department.parentId')
  log('═══════════════════════════════════════════════════\n')

  // We already checked — Department has no parentId
  log('❌ Department model HIỆN KHÔNG CÓ field parentId.')
  log('   → Cần thêm migration: ALTER TABLE departments ADD COLUMN parent_id TEXT REFERENCES departments(id);')
  log('   → Prisma schema: parentId String? @map("parent_id"), parent Department? @relation(...), children Department[] @relation(...)')
  log('')

  // ════════════════════════════════════════════════════════
  // E. Role DB vs Code: tên cần đổi
  // ════════════════════════════════════════════════════════

  log('═══════════════════════════════════════════════════')
  log('E. ROLE RENAME ĐỀ XUẤT (DB → Code)')
  log('═══════════════════════════════════════════════════\n')

  const CODE_ROLE_NAMES: Record<string, string> = {
    R02a: 'Nhân viên Quản lý Dự án',
    R03a: 'Nhân viên Kinh tế Kế hoạch',
    R04a: 'Nhân viên Thiết kế',
    R05a: 'Nhân viên Kho',
    R06a: 'Nhân viên Sản xuất',
    R07a: 'Nhân viên Thương mại',
    R08a: 'Nhân viên Kế toán',
    R11: '(VÔ HIỆU HOÁ — không đổi tên)',
    R13: 'Trưởng phòng Thiết bị & Cơ giới',
  }

  log('| roleCode | Tên hiện (DB) | Tên đề xuất | Hành động |')
  log('|----------|--------------|-------------|-----------|')
  for (const r of dbRoles) {
    const proposed = CODE_ROLE_NAMES[r.code]
    if (proposed && proposed !== r.name) {
      const action = r.code === 'R11' ? 'Giữ nguyên tên, VÔ HIỆU HOÁ user' : 'Đổi tên'
      log(`| ${r.code} | ${r.name} | ${proposed} | ${action} |`)
    }
  }

  // R13: check if exists
  const r13Exists = dbRoleMap.has('R13')
  if (!r13Exists) {
    log(`| R13 | _(chưa có)_ | Trưởng phòng Thiết bị & Cơ giới | TẠO MỚI |`)
  }
  log('')

  // ════════════════════════════════════════════════════════
  // F. TẤT CẢ CẢNH BÁO
  // ════════════════════════════════════════════════════════

  log('═══════════════════════════════════════════════════')
  log('F. TẤT CẢ CẢNH BÁO')
  log('═══════════════════════════════════════════════════\n')

  // Unmapped role warnings
  for (const [rc, uList] of [...unmappedRoleUsers.entries()].sort()) {
    const dbRole = dbRoleMap.get(rc)
    warnings.push(`⚠ ROLE CHƯA MAP: ${rc} "${dbRole?.name || '?'}" — ${uList.length} user: ${uList.map(u => `${u.fullName} (${u.username})`).join('; ')}`)
  }

  // TO- with 0 user already in warnings

  if (warnings.length > 0) {
    warnings.forEach((w, i) => log(`${i + 1}. ${w}`))
  } else {
    log('_(không có cảnh báo)_')
  }
  log('')

  // ════════════════════════════════════════════════════════
  // G. TỔNG HỢP
  // ════════════════════════════════════════════════════════

  log('═══════════════════════════════════════════════════')
  log('G. TỔNG HỢP')
  log('═══════════════════════════════════════════════════\n')

  const keepDepts = deptPlan.filter(p => p.action === 'GIỮ (target)').length
  const toDeptKeep = deptPlan.filter(p => p.action === 'TỔ CON → parent SX').length
  const deleteDepts = deptPlan.filter(p => p.action.startsWith('XOÁ')).length
  const warnDepts = deptPlan.filter(p => p.action === '⚠ CÒN USER').length

  log(`| Chỉ số | Giá trị |`)
  log(`|--------|---------|`)
  log(`| Tổng user | ${users.length} |`)
  log(`| User active | ${users.filter(u => u.isActive).length} |`)
  log(`| User reassign dept | ${reassignUsers.length} |`)
  log(`| User R11 vô hiệu | ${deactivateUsers.length} |`)
  log(`| User R12 giữ nguyên | ${skipUsers.length} |`)
  log(`| Trần Sỹ Mạnh | R04→R13, dept→TBCG |`)
  log(`| Role chưa map | ${unmappedRoleUsers.size} (${[...unmappedRoleUsers.values()].reduce((s, l) => s + l.length, 0)} user) |`)
  log(`| Dept GIỮ (10 target) | ${keepDepts} |`)
  log(`| Dept TỔ CON (TO-*) | ${toDeptKeep} |`)
  log(`| Dept XOÁ | ${deleteDepts} |`)
  log(`| Dept ⚠ cần quyết định | ${warnDepts} |`)
  log(`| Cảnh báo | ${warnings.length} |`)
  log(`| Department.parentId | ❌ CHƯA CÓ |`)
  log('')

  await prisma.$disconnect()
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
