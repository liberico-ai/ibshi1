/**
 * Việc 3 — Tạo tài khoản cán bộ phòng còn thiếu.
 * Nguồn: docs/handoff/TaoMoi_31_CanBoPhong_2026-07-08.csv
 *   cột: ma, ten, phong_file, dept_erp, role_de_xuat, username_sdt
 *
 * Mỗi dòng:
 *  - skip nếu đã có user (username=username_sdt) HOẶC employee (employeeCode=ma)
 *  - deptId = department.findUnique({ code: dept_erp })
 *  - user = create { username, passwordHash: bcrypt('123456'), fullName, roleCode,
 *                    departmentId, isActive:true, userLevel: role kết thúc 'a'?2:1 }
 *  - employee = create { employeeCode:ma, fullName:ten, phone:username_sdt, departmentId, userId }
 *
 * Mật khẩu mặc định 123456 (bcryptjs, cost 12 — khớp hashPassword của app).
 * DRY-RUN mặc định. --apply để ghi (1 transaction).
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import { readFileSync } from 'fs'

const CSV = 'docs/handoff/TaoMoi_31_CanBoPhong_2026-07-08.csv'
const APPLY = process.argv.includes('--apply')
const DEFAULT_PW_HASH = bcrypt.hashSync('123456', 12)

function createPrisma() {
  const cs = process.env.DATABASE_URL
  if (!cs) throw new Error('DATABASE_URL required')
  const isRemote = !cs.includes('@localhost') && !cs.includes('@127.0.0.1')
  const pool = new pg.Pool({ connectionString: cs, max: 3, connectionTimeoutMillis: 5000, ...(isRemote && { ssl: { rejectUnauthorized: false } }) })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PrismaClient({ adapter: new PrismaPg(pool as any) })
}

function parseCsv(path: string): Record<string, string>[] {
  const lines = readFileSync(path, 'utf8').trim().split(/\r?\n/)
  const head = lines[0].split(',')
  return lines.slice(1).filter(l => l.trim()).map(l => {
    const cells: string[] = []; let cur = '', q = false
    for (const ch of l) {
      if (ch === '"') q = !q
      else if (ch === ',' && !q) { cells.push(cur); cur = '' }
      else cur += ch
    }
    cells.push(cur)
    return Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? '').replace(/^"|"$/g, '')]))
  })
}

async function main() {
  const prisma = createPrisma()
  const rows = parseCsv(CSV)
  console.log(`Rows: ${rows.length} | Mode: ${APPLY ? '⚡ APPLY' : '🔍 DRY-RUN'}`)

  const depts = await prisma.department.findMany({ select: { id: true, code: true } })
  const deptByCode = new Map(depts.map(d => [d.code, d.id]))

  let created = 0, skipUser = 0, skipEmp = 0, errNoDept = 0
  const roleCount: Record<string, number> = {}
  await prisma.$transaction(async (tx) => {
    for (const r of rows) {
      const deptId = deptByCode.get(r.dept_erp)
      if (!deptId) { console.warn(`  ✗ dept không tồn tại "${r.dept_erp}" — ${r.ten}`); errNoDept++; continue }

      const uExists = await tx.user.findUnique({ where: { username: r.username_sdt }, select: { id: true } })
      if (uExists) { console.warn(`  ⚠ username ${r.username_sdt} đã tồn tại — bỏ qua ${r.ten}`); skipUser++; continue }
      const eExists = await tx.employee.findUnique({ where: { employeeCode: r.ma }, select: { id: true } })
      if (eExists) { console.warn(`  ⚠ employeeCode ${r.ma} đã tồn tại — bỏ qua ${r.ten}`); skipEmp++; continue }

      const userLevel = r.role_de_xuat.endsWith('a') ? 2 : 1
      console.log(`  + ${r.username_sdt}  ${r.ten}  ${r.role_de_xuat}(lv${userLevel})  dept=${r.dept_erp}  ma=${r.ma}`)
      roleCount[r.role_de_xuat] = (roleCount[r.role_de_xuat] || 0) + 1
      if (APPLY) {
        const user = await tx.user.create({
          data: {
            username: r.username_sdt, passwordHash: DEFAULT_PW_HASH, fullName: r.ten,
            roleCode: r.role_de_xuat, departmentId: deptId, isActive: true, userLevel,
          },
        })
        await tx.employee.create({
          data: { employeeCode: r.ma, fullName: r.ten, phone: r.username_sdt, departmentId: deptId, userId: user.id, status: 'ACTIVE' },
        })
      }
      created++
    }
    if (!APPLY) throw new Error('DRY-RUN rollback')
  }, { timeout: 180000 }).catch(e => { if (!String(e.message).includes('DRY-RUN')) throw e })

  console.log(`\nTạo: ${created} | Bỏ qua (user có): ${skipUser} | Bỏ qua (emp code có): ${skipEmp} | Lỗi dept: ${errNoDept}`)
  console.log('Role:', Object.entries(roleCount).sort())
  await prisma.$disconnect()
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
