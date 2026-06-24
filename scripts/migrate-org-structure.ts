/**
 * Migrate DB to match new 10-department org structure.
 *
 * DRY-RUN by default (read-only). Pass --apply to write changes in a transaction.
 *
 * Usage:
 *   npx tsx scripts/migrate-org-structure.ts              # dry-run
 *   npx tsx scripts/migrate-org-structure.ts --apply       # apply
 *
 * ── Production procedure ──
 *   # 1. Deploy code + prisma migrate deploy (adds parent_id column)
 *   # 2. Backup
 *   pg_dump "$DATABASE_URL" -Fc > backup_before_org_$(date +%Y%m%d_%H%M%S).dump
 *   # 3. Load production env
 *   set -a; source .env.backup.production; set +a
 *   # 4. Dry-run
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/migrate-org-structure.ts
 *   # 5. Apply
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/migrate-org-structure.ts --apply
 *   # 6. Verify
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/report-org-structure.ts
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

// ── Target structure ──

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
const TARGET_CODES = new Set(TARGET_DEPTS.map(d => d.code))

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
  R13: 'TBCG',
}

const ROLE_RENAMES: Record<string, { name: string; nameEn: string }> = {
  R02a: { name: 'Nhân viên Quản lý Dự án', nameEn: 'Project Staff' },
  R03a: { name: 'Nhân viên Kinh tế Kế hoạch', nameEn: 'Planning Staff' },
  R04a: { name: 'Nhân viên Thiết kế', nameEn: 'Engineering Staff' },
  R05a: { name: 'Nhân viên Kho', nameEn: 'Warehouse Staff' },
  R06a: { name: 'Nhân viên Sản xuất', nameEn: 'Production Staff' },
  R07a: { name: 'Nhân viên Thương mại', nameEn: 'Commercial Staff' },
  R08a: { name: 'Nhân viên Kế toán', nameEn: 'Accounting Staff' },
}

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

const APPLY = process.argv.includes('--apply')

async function main() {
  const prisma = createPrisma()
  const log = (s: string) => console.log(s)

  log(`\n${'='.repeat(60)}`)
  log(`  QUY HOẠCH CƠ CẤU TỔ CHỨC — ${APPLY ? '⚡ APPLY' : '🔍 DRY-RUN'}`)
  log(`${'='.repeat(60)}\n`)

  const stats = { roleUpsert: 0, deptUpsert: 0, userReassign: 0, userSkipTO: 0,
    toParented: 0, toDeleted: 0, r11Deactivated: 0, deptDeleted: 0, manhResult: '',
    empSynced: 0, empNulled: 0 }

  // ═══════════════════════════════════════════════
  // a. Upsert Role R13, rename deputy roles
  // ═══════════════════════════════════════════════
  log('[a] Upsert R13 + rename deputy roles')

  const r13 = await prisma.role.findUnique({ where: { code: 'R13' } })
  if (!r13) {
    log('    R13: TẠO MỚI — Trưởng phòng Thiết bị & Cơ giới')
    if (APPLY) await prisma.role.create({ data: { code: 'R13', name: 'Trưởng phòng Thiết bị & Cơ giới', nameEn: 'Equipment & Mechanical Head' } })
    stats.roleUpsert++
  } else if (r13.name !== 'Trưởng phòng Thiết bị & Cơ giới') {
    log(`    R13: "${r13.name}" → "Trưởng phòng Thiết bị & Cơ giới"`)
    if (APPLY) await prisma.role.update({ where: { code: 'R13' }, data: { name: 'Trưởng phòng Thiết bị & Cơ giới', nameEn: 'Equipment & Mechanical Head' } })
    stats.roleUpsert++
  } else {
    log('    R13: OK')
  }

  for (const [code, data] of Object.entries(ROLE_RENAMES)) {
    const r = await prisma.role.findUnique({ where: { code } })
    if (r && r.name !== data.name) {
      log(`    ${code}: "${r.name}" → "${data.name}"`)
      if (APPLY) await prisma.role.update({ where: { code }, data })
      stats.roleUpsert++
    }
  }

  // ═══════════════════════════════════════════════
  // b. Upsert 10 target departments
  // ═══════════════════════════════════════════════
  log('\n[b] Upsert 10 phòng ban')

  for (const dept of TARGET_DEPTS) {
    const existing = await prisma.department.findUnique({ where: { code: dept.code } })
    if (existing) {
      if (existing.name !== dept.name) {
        log(`    ${dept.code}: "${existing.name}" → "${dept.name}"`)
        if (APPLY) await prisma.department.update({ where: { code: dept.code }, data: { name: dept.name } })
      } else {
        log(`    ${dept.code}: OK`)
      }
    } else {
      log(`    ${dept.code}: TẠO MỚI — "${dept.name}"`)
      if (APPLY) await prisma.department.create({ data: { code: dept.code, name: dept.name } })
    }
    stats.deptUpsert++
  }

  // ═══════════════════════════════════════════════
  // c. Reassign users — SKIP those in TO-* depts
  // ═══════════════════════════════════════════════
  log('\n[c] Reassign user → dept (chừa tổ TO-*)')

  const allDepts = await prisma.department.findMany()
  const deptIdByCode = new Map(allDepts.map(d => [d.code, d.id]))
  const deptById = new Map(allDepts.map(d => [d.id, d]))

  // In dry-run, target depts may not exist yet — use placeholder IDs so reassign logic proceeds
  for (const td of TARGET_DEPTS) {
    if (!deptIdByCode.has(td.code)) {
      const placeholderId = `__pending_${td.code}`
      deptIdByCode.set(td.code, placeholderId)
      deptById.set(placeholderId, { id: placeholderId, code: td.code, name: td.name } as typeof allDepts[0])
    }
  }

  const users = await prisma.user.findMany({
    select: { id: true, username: true, fullName: true, roleCode: true, departmentId: true, isActive: true, userLevel: true },
    orderBy: { roleCode: 'asc' },
  })

  for (const u of users) {
    if (u.roleCode === 'R11') continue // handled in step f
    const targetDeptCode = ROLE_TO_DEPT[u.roleCode]
    if (!targetDeptCode) continue // unmapped role (R12 etc.) — skip

    const targetDeptId = deptIdByCode.get(targetDeptCode)
    if (!targetDeptId) {
      log(`    ⚠ ${u.fullName} (${u.username}) → dept ${targetDeptCode} chưa có trong DB`)
      continue
    }

    // Key rule: if user is in a TO-* dept, keep them there
    const currentDept = u.departmentId ? deptById.get(u.departmentId) : null
    if (currentDept && currentDept.code.startsWith('TO-')) {
      stats.userSkipTO++
      continue
    }

    if (u.departmentId !== targetDeptId) {
      log(`    ${u.fullName} (${u.username}): ${currentDept?.code || '(none)'} → ${targetDeptCode}`)
      if (APPLY) await prisma.user.update({ where: { id: u.id }, data: { departmentId: targetDeptId } })
      stats.userReassign++
    }
  }

  log(`    (${stats.userSkipTO} user ở tổ TO-* giữ nguyên)`)

  // ═══════════════════════════════════════════════
  // d. Set parentId=SX for TO-* depts, delete TO-GL1
  // ═══════════════════════════════════════════════
  log('\n[d] Tổ sản xuất TO-* → parentId = SX')

  const sxId = deptIdByCode.get('SX')
  const toDepts = allDepts.filter(d => d.code.startsWith('TO-'))

  for (const d of toDepts) {
    const userCount = users.filter(u => u.departmentId === d.id).length
    if (userCount === 0) {
      log(`    ${d.code} "${d.name}": 0 user → XOÁ`)
      if (APPLY) await prisma.department.delete({ where: { id: d.id } })
      stats.toDeleted++
    } else {
      log(`    ${d.code}: ${userCount} user → parentId = SX`)
      if (APPLY && sxId) {
        await prisma.department.update({ where: { id: d.id }, data: { parentId: sxId } })
      }
      stats.toParented++
    }
  }

  // ═══════════════════════════════════════════════
  // e. Trần Sỹ Mạnh → R13 + TBCG + username manhts
  // ═══════════════════════════════════════════════
  log('\n[e] Trần Sỹ Mạnh → R13 + TBCG + username manhts')

  const manh = users.find(u => u.username === 'manhtv')
  const tbcgId = deptIdByCode.get('TBCG')
  const NEW_USERNAME = 'manhts'

  if (manh) {
    // Check for username collision
    const existing = await prisma.user.findUnique({ where: { username: NEW_USERNAME } })
    if (existing) {
      log(`    ❌ DỪNG: username '${NEW_USERNAME}' đã tồn tại (id=${existing.id})! Không thể đổi.`)
      await prisma.$disconnect()
      process.exit(1)
    }

    const oldDept = manh.departmentId ? deptById.get(manh.departmentId) : null
    stats.manhResult = `${manh.fullName}: username manhtv→${NEW_USERNAME}, role ${manh.roleCode}→R13, dept ${oldDept?.code || '(none)'}→TBCG`
    log(`    ${stats.manhResult}`)
    if (APPLY && tbcgId) {
      await prisma.user.update({
        where: { id: manh.id },
        data: { username: NEW_USERNAME, roleCode: 'R13', departmentId: tbcgId, userLevel: 1, isActive: true },
      })
      log('    ✅ Đã cập nhật')
    }
  } else {
    stats.manhResult = '⚠ Không tìm thấy user manhtv'
    log(`    ${stats.manhResult}`)
  }

  // ═══════════════════════════════════════════════
  // f. Deactivate R11 users, remove PB-HCNS
  // ═══════════════════════════════════════════════
  log('\n[f] Vô hiệu hoá 13 user R11 (HCNS)')

  const r11Users = users.filter(u => u.roleCode === 'R11')
  for (const u of r11Users) {
    const d = u.departmentId ? deptById.get(u.departmentId) : null
    log(`    ${u.fullName} (${u.username}): dept ${d?.code || '(none)'} → isActive=false, dept=null`)
    if (APPLY) {
      await prisma.user.update({ where: { id: u.id }, data: { isActive: false, departmentId: null } })
    }
    stats.r11Deactivated++
  }

  // Delete PB-HCNS if empty after deactivation
  const pbHcns = allDepts.find(d => d.code === 'PB-HCNS')
  if (pbHcns) {
    if (APPLY) {
      const remaining = await prisma.user.count({ where: { departmentId: pbHcns.id } })
      if (remaining === 0) {
        await prisma.department.delete({ where: { id: pbHcns.id } })
        log('    PB-HCNS: 0 user → XOÁ')
      } else {
        log(`    ⚠ PB-HCNS: ${remaining} user còn → KHÔNG XOÁ`)
      }
    } else {
      log(`    PB-HCNS: ${r11Users.filter(u => u.departmentId === pbHcns.id).length} user R11 → sẽ xoá sau deactivate`)
    }
  }

  // ═══════════════════════════════════════════════
  // g. Sync Employee.departmentId (trước khi xoá dept)
  // ═══════════════════════════════════════════════
  log('\n[g] Sync Employee.departmentId')

  // Build set of dept IDs that will be deleted (legacy + PB-HCNS + empty TO-*)
  const keepDeptCodes = new Set([...TARGET_CODES, ...toDepts.filter(d => users.some(u => u.departmentId === d.id)).map(d => d.code)])
  const deletingDeptIds = new Set(allDepts.filter(d => !keepDeptCodes.has(d.code)).map(d => d.id))

  const employees = await prisma.employee.findMany({
    where: { departmentId: { not: null } },
    select: { id: true, userId: true, departmentId: true, fullName: true },
  })

  let empSynced = 0
  let empNulled = 0
  for (const emp of employees) {
    if (!emp.departmentId || !deletingDeptIds.has(emp.departmentId)) continue
    const oldDeptObj = deptById.get(emp.departmentId)

    // Try to follow the user's new dept
    let newDeptId: string | null = null
    if (emp.userId) {
      const linkedUser = users.find(u => u.id === emp.userId)
      if (linkedUser && linkedUser.isActive && linkedUser.roleCode !== 'R11') {
        const targetCode = ROLE_TO_DEPT[linkedUser.roleCode]
        if (targetCode) {
          const tid = deptIdByCode.get(targetCode)
          if (tid) newDeptId = tid
        }
        // If user is in TO-*, use their current dept (it stays)
        if (!newDeptId && linkedUser.departmentId) {
          const ud = deptById.get(linkedUser.departmentId)
          if (ud && ud.code.startsWith('TO-')) newDeptId = linkedUser.departmentId
        }
      }
    }

    if (newDeptId) {
      const newDeptObj = deptById.get(newDeptId)
      log(`    ${emp.fullName}: ${oldDeptObj?.code || '?'} → ${newDeptObj?.code || '?'} (theo User)`)
      if (APPLY) await prisma.employee.update({ where: { id: emp.id }, data: { departmentId: newDeptId } })
      empSynced++
    } else {
      log(`    ${emp.fullName}: ${oldDeptObj?.code || '?'} → null`)
      if (APPLY) await prisma.employee.update({ where: { id: emp.id }, data: { departmentId: null } })
      empNulled++
    }
  }

  stats.empSynced = empSynced
  stats.empNulled = empNulled
  log(`    (${empSynced} theo User, ${empNulled} → null, tổng ${empSynced + empNulled})`)

  // ═══════════════════════════════════════════════
  // h. Delete empty legacy depts
  // ═══════════════════════════════════════════════
  log('\n[h] Xoá dept thừa (0 user sau reassign)')

  // Refresh after changes
  const refreshDepts = await prisma.department.findMany({
    include: { _count: { select: { users: true } } },
    orderBy: { code: 'asc' },
  })

  for (const d of refreshDepts) {
    if (TARGET_CODES.has(d.code)) continue // keep target depts
    if (d.code.startsWith('TO-')) continue // TO-* handled in step d

    const liveCount = APPLY
      ? await prisma.user.count({ where: { departmentId: d.id } })
      : d._count.users

    // For dry-run, simulate reassign effect
    let simCount = liveCount
    if (!APPLY) {
      const deptUsers = users.filter(u => u.departmentId === d.id)
      simCount = deptUsers.filter(u => {
        if (u.roleCode === 'R11') return false // deactivated
        const targetDept = ROLE_TO_DEPT[u.roleCode]
        if (!targetDept) return true // unmapped stays
        const currentDeptObj = deptById.get(d.id)
        if (currentDeptObj && currentDeptObj.code.startsWith('TO-')) return true // kept in TO-*
        return false // will be reassigned away
      }).length
    }

    if (APPLY ? liveCount === 0 : simCount === 0) {
      if (APPLY) {
        const empLeft = await prisma.employee.count({ where: { departmentId: d.id } })
        if (empLeft > 0) {
          log(`    ⚠ ${d.code} "${d.name}": 0 user nhưng ${empLeft} employee CÒN → KHÔNG XOÁ`)
          continue
        }
        await prisma.department.delete({ where: { id: d.id } })
      }
      log(`    ${d.code} "${d.name}": 0 user → XOÁ`)
      stats.deptDeleted++
    } else {
      const cnt = APPLY ? liveCount : simCount
      log(`    ⚠ ${d.code} "${d.name}": ${cnt} user CÒN`)
    }
  }

  // ═══════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════
  log(`\n${'─'.repeat(50)}`)
  log(`TỔNG KẾT ${APPLY ? '(ĐÃ APPLY)' : '(DRY-RUN)'}:`)
  log(`  Role upsert/rename: ${stats.roleUpsert}`)
  log(`  Dept upsert: ${stats.deptUpsert}`)
  log(`  User reassign: ${stats.userReassign} (${stats.userSkipTO} giữ tổ TO-*)`)
  log(`  TO-* parent=SX: ${stats.toParented}, TO-* xoá: ${stats.toDeleted}`)
  log(`  Trần Sỹ Mạnh: ${stats.manhResult}`)
  log(`  R11 deactivated: ${stats.r11Deactivated}`)
  log(`  Employee sync: ${stats.empSynced} theo User, ${stats.empNulled} → null`)
  log(`  Dept xoá: ${stats.deptDeleted}`)
  if (!APPLY) {
    log(`\n  → Chạy lại với --apply để áp dụng.`)
  }
  log('')

  await prisma.$disconnect()
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
