/**
 * Migrate DB to match new 10-department org structure.
 *
 * DRY-RUN by default (read-only). Pass --apply to write changes.
 *
 * Usage:
 *   npx tsx scripts/migrate-org-structure.ts              # dry-run on .env DB
 *   npx tsx scripts/migrate-org-structure.ts --apply       # apply on .env DB
 *   npx tsx scripts/migrate-org-structure.ts --apply --create-tbcg-head="Trần Sỹ Mạnh|manhts|manh@ibs.vn"
 *
 * ── Production procedure ──
 *   # 1. Backup
 *   pg_dump "$DATABASE_URL" -Fc > backup_before_org_migrate_$(date +%Y%m%d_%H%M%S).dump
 *
 *   # 2. Load production env
 *   set -a; source .env.backup.production; set +a
 *
 *   # 3. Dry-run first
 *   npx tsx scripts/migrate-org-structure.ts
 *
 *   # 4. Apply
 *   npx tsx scripts/migrate-org-structure.ts --apply --create-tbcg-head="Trần Sỹ Mạnh|manhts|manh@ibs.vn"
 *
 *   # 5. Verify
 *   npx tsx scripts/report-org-structure.ts
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import crypto from 'crypto'

// ── New org structure (must match src/lib/org-map.ts) ──

const TARGET_DEPTS: { code: string; name: string }[] = [
  { code: 'BGD', name: 'Ban Giám đốc' },
  { code: 'CNTT', name: 'CNTT & Dữ liệu' },
  { code: 'TK', name: 'Phòng Kỹ thuật' },
  { code: 'KTKH', name: 'Kinh tế Kế hoạch' },
  { code: 'TM', name: 'Thương mại' },
  { code: 'QLDA', name: 'Quản lý Dự án' },
  { code: 'SX', name: 'Sản xuất' },
  { code: 'TCKT', name: 'Tài chính Kế toán & Kho' },
  { code: 'QC', name: 'QA/QC' },
  { code: 'TBCG', name: 'Thiết bị & Cơ giới' },
]

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

const TARGET_DEPT_CODES = new Set(TARGET_DEPTS.map(d => d.code))

// ── Vietnamese normalization for name matching ──

function normalize(s: string): string {
  return s.normalize('NFC').replace(/[̀-̣ͯ̉̃́̀]/g, '')
    .replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim()
}

// ── DB setup ──

function createPrisma() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required')
  const isRemote = !connectionString.includes('@localhost') && !connectionString.includes('@127.0.0.1')
  const pool = new pg.Pool({
    connectionString, max: 3, connectionTimeoutMillis: 5000,
    ...(isRemote && { ssl: { rejectUnauthorized: false } }),
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PrismaClient({ adapter: new PrismaPg(pool as any) })
}

// ── Main ──

const APPLY = process.argv.includes('--apply')

function parseCreateFlag(): { fullName: string; username: string; email: string } | null {
  const arg = process.argv.find(a => a.startsWith('--create-tbcg-head='))
  if (!arg) return null
  const val = arg.split('=')[1]
  const parts = val.split('|')
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    console.error('❌ --create-tbcg-head phải có format: "Họ Tên|username|email"')
    process.exit(1)
  }
  return { fullName: parts[0], username: parts[1], email: parts[2] }
}

const CREATE_TBCG_HEAD = parseCreateFlag()

async function main() {
  const prisma = createPrisma()
  const log = (s: string) => console.log(s)

  log(`\n${'='.repeat(60)}`)
  log(`  QUY HOẠCH CƠ CẤU TỔ CHỨC — ${APPLY ? '⚡ APPLY MODE' : '🔍 DRY-RUN'}`)
  log(`${'='.repeat(60)}\n`)

  let deptUpserted = 0
  let userReassigned = 0
  let deptDeleted = 0
  let manhChanges = ''

  // ═══════════════════════════════════════════════
  // 1. Upsert Role R11 nếu chưa có
  // ═══════════════════════════════════════════════
  const existingR11 = await prisma.role.findUnique({ where: { code: 'R11' } })
  if (!existingR11) {
    log('[1] Role R11 chưa tồn tại → sẽ tạo mới')
    if (APPLY) {
      await prisma.role.create({ data: { code: 'R11', name: 'Trưởng phòng Thiết bị & Cơ giới', nameEn: 'Equipment & Mechanical Head' } })
      log('    ✅ Đã tạo R11')
    }
  } else {
    log(`[1] Role R11 đã có: "${existingR11.name}" → sẽ cập nhật tên`)
    if (APPLY) {
      await prisma.role.update({ where: { code: 'R11' }, data: { name: 'Trưởng phòng Thiết bị & Cơ giới', nameEn: 'Equipment & Mechanical Head' } })
    }
  }

  // Update existing role names to match ROLES in constants.ts
  const ROLE_NAMES: Record<string, { name: string; nameEn: string }> = {
    R02a: { name: 'Nhân viên Quản lý Dự án', nameEn: 'Project Staff' },
    R03a: { name: 'Nhân viên Kinh tế Kế hoạch', nameEn: 'Planning Staff' },
    R04a: { name: 'Nhân viên Thiết kế', nameEn: 'Engineering Staff' },
    R05a: { name: 'Nhân viên Kho', nameEn: 'Warehouse Staff' },
    R06a: { name: 'Nhân viên Sản xuất', nameEn: 'Production Staff' },
    R07a: { name: 'Nhân viên Thương mại', nameEn: 'Commercial Staff' },
    R08a: { name: 'Nhân viên Kế toán', nameEn: 'Accounting Staff' },
  }
  for (const [code, data] of Object.entries(ROLE_NAMES)) {
    const r = await prisma.role.findUnique({ where: { code } })
    if (r && r.name !== data.name) {
      log(`    Role ${code}: "${r.name}" → "${data.name}"`)
      if (APPLY) {
        await prisma.role.update({ where: { code }, data })
      }
    }
  }

  // ═══════════════════════════════════════════════
  // 2. Upsert 10 phòng ban
  // ═══════════════════════════════════════════════
  log('\n[2] Upsert 10 phòng ban')
  for (const dept of TARGET_DEPTS) {
    const existing = await prisma.department.findUnique({ where: { code: dept.code } })
    if (existing) {
      if (existing.name !== dept.name) {
        log(`    ${dept.code}: "${existing.name}" → "${dept.name}"`)
        if (APPLY) await prisma.department.update({ where: { code: dept.code }, data: { name: dept.name } })
      } else {
        log(`    ${dept.code}: OK (đã đúng)`)
      }
    } else {
      log(`    ${dept.code}: TẠO MỚI — "${dept.name}"`)
      if (APPLY) await prisma.department.create({ data: { code: dept.code, name: dept.name } })
    }
    deptUpserted++
  }

  // ═══════════════════════════════════════════════
  // 3. Reassign departmentId cho mỗi User
  // ═══════════════════════════════════════════════
  log('\n[3] Reassign User → Department (theo ROLE_TO_DEPT)')

  // Build deptCode → deptId lookup (after upsert)
  const allDepts = await prisma.department.findMany()
  const deptIdByCode = new Map(allDepts.map(d => [d.code, d.id]))

  const users = await prisma.user.findMany({
    select: { id: true, username: true, fullName: true, roleCode: true, departmentId: true, isActive: true },
    orderBy: { roleCode: 'asc' },
  })

  for (const u of users) {
    const targetDeptCode = ROLE_TO_DEPT[u.roleCode]
    if (!targetDeptCode) {
      log(`    ⚠ ${u.fullName} (${u.username}) role=${u.roleCode} → KHÔNG có trong ROLE_TO_DEPT, bỏ qua`)
      continue
    }
    const targetDeptId = deptIdByCode.get(targetDeptCode)
    if (!targetDeptId) {
      log(`    ⚠ ${u.fullName} (${u.username}) → dept ${targetDeptCode} chưa có trong DB, bỏ qua`)
      continue
    }
    if (u.departmentId !== targetDeptId) {
      const oldDept = allDepts.find(d => d.id === u.departmentId)
      log(`    ${u.fullName} (${u.username}): ${oldDept?.code || '(none)'} → ${targetDeptCode}`)
      if (APPLY) await prisma.user.update({ where: { id: u.id }, data: { departmentId: targetDeptId } })
      userReassigned++
    }
  }
  if (userReassigned === 0) log('    (tất cả đã đúng)')

  // ═══════════════════════════════════════════════
  // 4. Trần Sỹ Mạnh → R11 + TBCG
  // ═══════════════════════════════════════════════
  log('\n[4] Trưởng phòng TBCG → R11')

  const targetName = normalize('Trần Sỹ Mạnh')
  const match = users.find(u => normalize(u.fullName) === targetName)
  const tbcgId = deptIdByCode.get('TBCG')

  if (match) {
    const oldDept = allDepts.find(d => d.id === match.departmentId)
    manhChanges = `${match.fullName} (${match.username}): role ${match.roleCode}→R11, dept ${oldDept?.code || '(none)'}→TBCG, isActive=${match.isActive}→true`
    log(`    Tìm thấy: ${manhChanges}`)

    if (APPLY && tbcgId) {
      await prisma.user.update({
        where: { id: match.id },
        data: { roleCode: 'R11', departmentId: tbcgId, isActive: true },
      })
      log('    ✅ Đã cập nhật')
    }
  } else if (CREATE_TBCG_HEAD) {
    manhChanges = `TẠO MỚI: ${CREATE_TBCG_HEAD.fullName} (${CREATE_TBCG_HEAD.username}) — ${CREATE_TBCG_HEAD.email}`
    log(`    Không tìm thấy Trần Sỹ Mạnh → sẽ tạo mới từ --create-tbcg-head`)
    log(`    ${manhChanges}`)

    if (APPLY && tbcgId) {
      const tempPassword = crypto.randomBytes(12).toString('base64url')
      const bcrypt = await import('bcryptjs')
      const hashedPassword = await bcrypt.hash(tempPassword, 10)

      await prisma.user.create({
        data: {
          username: CREATE_TBCG_HEAD.username,
          passwordHash: hashedPassword,
          fullName: CREATE_TBCG_HEAD.fullName,
          email: CREATE_TBCG_HEAD.email,
          roleCode: 'R11',
          departmentId: tbcgId,
          userLevel: 1,
          isActive: true,
        },
      })
      log(`    ✅ Đã tạo user. Mật khẩu tạm: ${tempPassword}`)
      log(`    ⚠ HÃY ĐỔI MẬT KHẨU NGAY SAU KHI ĐĂNG NHẬP!`)
    }
  } else {
    manhChanges = '⚠ Không tìm thấy Trần Sỹ Mạnh — dùng --create-tbcg-head="Họ Tên|username|email" để tạo mới'
    log(`    ${manhChanges}`)
    if (APPLY) {
      log('    ❌ DỪNG: không tự tạo user mới. Truyền --create-tbcg-head nếu cần.')
    }
  }

  // ═══════════════════════════════════════════════
  // 5. Xoá Department thừa
  // ═══════════════════════════════════════════════
  log('\n[5] Xoá Department thừa (không thuộc 10 phòng chuẩn)')

  // Refresh dept list and user counts after reassign
  const refreshedDepts = await prisma.department.findMany({
    include: { _count: { select: { users: true } } },
  })
  for (const d of refreshedDepts) {
    if (!TARGET_DEPT_CODES.has(d.code)) {
      if (d._count.users === 0 || APPLY) {
        // Re-check in apply mode since we may have reassigned
        const liveCount = APPLY
          ? await prisma.user.count({ where: { departmentId: d.id } })
          : d._count.users
        if (liveCount === 0) {
          log(`    ${d.code} "${d.name}": 0 user → XOÁ`)
          if (APPLY) await prisma.department.delete({ where: { id: d.id } })
          deptDeleted++
        } else {
          log(`    ⚠ ${d.code} "${d.name}": ${liveCount} user còn lại → KHÔNG XOÁ`)
        }
      } else {
        log(`    ⚠ ${d.code} "${d.name}": ${d._count.users} user → KHÔNG XOÁ (dry-run)`)
      }
    }
  }

  // ═══════════════════════════════════════════════
  // Tổng kết
  // ═══════════════════════════════════════════════
  log(`\n${'─'.repeat(50)}`)
  log(`TỔNG KẾT ${APPLY ? '(ĐÃ APPLY)' : '(DRY-RUN)'}:`)
  log(`  Dept upsert: ${deptUpserted}`)
  log(`  User reassign: ${userReassigned}`)
  log(`  Trần Sỹ Mạnh: ${manhChanges}`)
  log(`  Dept đã xoá: ${deptDeleted}`)
  if (!APPLY) {
    log(`\n  → Chạy lại với --apply để áp dụng thay đổi.`)
    log(`  → Trên prod: pg_dump trước, chạy dry-run trước!`)
  }
  log('')

  await prisma.$disconnect()
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
