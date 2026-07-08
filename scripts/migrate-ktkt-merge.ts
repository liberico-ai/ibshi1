/**
 * Gộp phòng KTKH + TM → KTKT (Kinh tế Kỹ thuật).
 * Giữ nguyên 4 roleCode R03/R03a/R07/R07a (RBAC keyed by roleCode — KHÔNG đổi quyền).
 * Chỉ gộp đơn vị tổ chức: dời user + employee của KTKH/TM sang KTKT, xoá 2 dept cũ.
 *
 * DRY-RUN mặc định (chỉ đọc). --apply để ghi trong 1 transaction.
 *
 * ── Quy trình prod ──
 *   # 1. Deploy code (org-map.ts đã map R03/R07 → KTKT)
 *   # 2. Backup:
 *   pg_dump "$DATABASE_URL" -Fc > backup_before_ktkt_$(date +%Y%m%d_%H%M%S).dump
 *   # 3. Load env prod, dry-run:
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/migrate-ktkt-merge.ts
 *   # 4. Apply:
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/migrate-ktkt-merge.ts --apply
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const OLD_CODES = ['KTKH', 'TM']
const NEW = { code: 'KTKT', name: 'Kinh tế Kỹ thuật' }

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
  log(`\n${'='.repeat(56)}\n  GỘP KTKH + TM → KTKT — ${APPLY ? '⚡ APPLY' : '🔍 DRY-RUN'}\n${'='.repeat(56)}\n`)

  const stats = { userMoved: 0, empMoved: 0, deptDeleted: 0 }

  await prisma.$transaction(async (tx) => {
    // 1. Upsert KTKT
    let ktkt = await tx.department.findUnique({ where: { code: NEW.code } })
    if (!ktkt) {
      log(`[1] KTKT: TẠO MỚI "${NEW.name}"`)
      ktkt = APPLY
        ? await tx.department.create({ data: { code: NEW.code, name: NEW.name } })
        : ({ id: '__pending_KTKT', code: NEW.code, name: NEW.name } as typeof ktkt)
    } else {
      log(`[1] KTKT: đã có (id=${ktkt.id})`)
    }

    const oldDepts = await tx.department.findMany({ where: { code: { in: OLD_CODES } } })
    if (oldDepts.length === 0) { log('    Không còn KTKH/TM — có thể đã gộp trước đó (idempotent).') }
    const oldIds = oldDepts.map(d => d.id)

    // 2. Dời user
    log('\n[2] Dời user KTKH/TM → KTKT')
    const users = await tx.user.findMany({
      where: { departmentId: { in: oldIds } },
      select: { id: true, username: true, fullName: true, roleCode: true },
    })
    for (const u of users) {
      log(`    ${u.fullName} (${u.username}, ${u.roleCode})`)
      if (APPLY) await tx.user.update({ where: { id: u.id }, data: { departmentId: ktkt!.id } })
      stats.userMoved++
    }

    // 3. Dời employee
    log('\n[3] Dời employee KTKH/TM → KTKT')
    const emps = await tx.employee.findMany({
      where: { departmentId: { in: oldIds } },
      select: { id: true, fullName: true },
    })
    for (const e of emps) {
      log(`    ${e.fullName}`)
      if (APPLY) await tx.employee.update({ where: { id: e.id }, data: { departmentId: ktkt!.id } })
      stats.empMoved++
    }

    // 4. Xoá KTKH/TM nếu đã rỗng
    log('\n[4] Xoá phòng cũ (nếu 0 user + 0 employee)')
    for (const d of oldDepts) {
      const uLeft = APPLY ? await tx.user.count({ where: { departmentId: d.id } }) : 0
      const eLeft = APPLY ? await tx.employee.count({ where: { departmentId: d.id } }) : 0
      const childLeft = await tx.department.count({ where: { parentId: d.id } })
      if (uLeft === 0 && eLeft === 0 && childLeft === 0) {
        log(`    ${d.code} "${d.name}": XOÁ`)
        if (APPLY) await tx.department.delete({ where: { id: d.id } })
        stats.deptDeleted++
      } else {
        log(`    ⚠ ${d.code}: còn user=${uLeft} emp=${eLeft} child=${childLeft} → KHÔNG XOÁ`)
      }
    }

    if (!APPLY) throw new Error('DRY-RUN rollback (chạy lại với --apply để ghi)')
  }, { timeout: 180000 }).catch(e => { if (!String(e.message).includes('DRY-RUN')) throw e })

  log(`\n${'─'.repeat(48)}\nTỔNG KẾT ${APPLY ? '(ĐÃ APPLY)' : '(DRY-RUN)'}: user dời ${stats.userMoved} · employee dời ${stats.empMoved} · dept xoá ${stats.deptDeleted}`)
  if (!APPLY) log('  → Chạy lại với --apply để áp dụng.')
  await prisma.$disconnect()
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
