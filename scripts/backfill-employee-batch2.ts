/**
 * Việc 2 — Backfill Employee (Mã NV) cho các user batch2 (employeeCode rỗng).
 * Nguồn: docs/handoff/username_phone_mapping_batch2.csv (status=OK)
 *   cột dùng: userId, employeeCode, fullName, dept_erp, new_username (=phone)
 *
 * Với mỗi dòng: nếu User CHƯA có Employee VÀ chưa có Employee mang employeeCode đó
 *   → tạo Employee { employeeCode, fullName, phone, departmentId (lookup dept_erp), userId, status:'ACTIVE' }.
 * Idempotent: bỏ qua nếu đã tồn tại. Employee.employeeCode UNIQUE.
 *
 * DRY-RUN mặc định. --apply để ghi (1 transaction).
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { readFileSync } from 'fs'

const CSV = 'docs/handoff/username_phone_mapping_batch2.csv'
const APPLY = process.argv.includes('--apply')

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
  return lines.slice(1).map(l => {
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
  const rows = parseCsv(CSV).filter(r => r.status === 'OK')
  console.log(`Rows OK: ${rows.length} | Mode: ${APPLY ? '⚡ APPLY' : '🔍 DRY-RUN'}`)

  // cache dept code → id
  const depts = await prisma.department.findMany({ select: { id: true, code: true } })
  const deptByCode = new Map(depts.map(d => [d.code, d.id]))

  let created = 0, skipHasEmp = 0, skipCodeTaken = 0, errNoDept = 0
  await prisma.$transaction(async (tx) => {
    for (const r of rows) {
      const deptId = deptByCode.get(r.dept_erp)
      if (!deptId) { console.warn(`  ✗ dept không tồn tại "${r.dept_erp}" — ${r.fullName}`); errNoDept++; continue }

      const hasEmp = await tx.employee.findFirst({ where: { userId: r.userId }, select: { id: true } })
      if (hasEmp) { skipHasEmp++; continue }
      const codeTaken = await tx.employee.findUnique({ where: { employeeCode: r.employeeCode }, select: { id: true, userId: true } })
      if (codeTaken) { console.warn(`  ⚠ employeeCode ${r.employeeCode} đã tồn tại (userId=${codeTaken.userId ?? 'null'}) — bỏ qua ${r.fullName}`); skipCodeTaken++; continue }

      console.log(`  + Employee ${r.employeeCode}  ${r.fullName}  phone=${r.new_username}  dept=${r.dept_erp}`)
      if (APPLY) {
        await tx.employee.create({
          data: { employeeCode: r.employeeCode, fullName: r.fullName, phone: r.new_username, departmentId: deptId, userId: r.userId, status: 'ACTIVE' },
        })
      }
      created++
    }
    if (!APPLY) throw new Error('DRY-RUN rollback')
  }, { timeout: 180000 }).catch(e => { if (!String(e.message).includes('DRY-RUN')) throw e })

  console.log(`\nTạo: ${created} | Bỏ qua (đã có employee): ${skipHasEmp} | Bỏ qua (code đã dùng): ${skipCodeTaken} | Lỗi dept: ${errNoDept}`)
  await prisma.$disconnect()
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
