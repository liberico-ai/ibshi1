// Migration cơ cấu tổ chức tháng 5/2026 (Tổ → Xưởng, gộp/tách phòng).
// Chạy: npx tsx scripts/migrate-org-2026-05.mjs [--commit]
//   mặc định DRY-RUN (chỉ in ra, không ghi). Thêm --commit để thực thi.
// An toàn: idempotent; KHÔNG xóa Department cũ (SX/tổ/QC/TBCG) — chỉ gán lại departmentId của user.
import fs from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const COMMIT = process.argv.includes('--commit')
const env = fs.readFileSync('.env', 'utf8')
const cs = process.env.DATABASE_URL || env.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m)[1]
const isR = !cs.includes('@localhost') && !cs.includes('@127.0.0.1')
const pool = new pg.Pool({ connectionString: cs, max: 3, ...(isR && { ssl: { rejectUnauthorized: false } }) })
const p = new PrismaClient({ adapter: new PrismaPg(pool) })

// 16 phòng/xưởng mới (khớp DEPARTMENTS_V2)
const DEPTS = [
  ['BGD', 'Ban Giám đốc'], ['CNTT', 'CNTT & Dữ liệu'],
  ['KHO', 'Bộ phận Kho'], ['HCNS', 'Phòng Hành chính Nhân sự'],
  ['TCKT', 'Phòng Tài chính Kế toán'], ['KTKT', 'Phòng Kinh tế Kỹ thuật'],
  ['QLDA', 'Phòng Dự án'], ['TK', 'Phòng Thiết kế'],
  ['QAQC', 'Phòng QAQC'], ['TB', 'Phòng Trang thiết bị'],
  ['XPC', 'Xưởng Pha cắt'], ['XCT1', 'Xưởng Chế tạo số 1'], ['XCT2', 'Xưởng Chế tạo số 2'],
  ['XH', 'Xưởng Hàn'], ['XHT', 'Xưởng Hoàn thiện'], ['SITEMGR', 'Site Manager'],
]
// Đổi mã: QC→QAQC, TBCG→TB (rename record cũ để không mồ côi + user giữ departmentId).
const RENAME = { QC: 'QAQC', TBCG: 'TB' }
// Tên "Bộ phận mới" (lowercase) → mã dept
const NAME_TO_CODE = {
  'ban giám đốc': 'BGD', 'bộ phận kho': 'KHO', 'phòng hành chính nhân sự': 'HCNS',
  'phòng kinh tế kỹ thuật': 'KTKT', 'phòng tài chính kế toán': 'TCKT', 'phòng dự án': 'QLDA',
  'phòng thiết kế': 'TK', 'phòng chất lượng': 'QAQC', 'phòng trang thiết bị': 'TB',
  'xưởng pha cắt': 'XPC', 'xưởng chế tạo số 1': 'XCT1', 'xưởng chế tạo số 2': 'XCT2',
  'xưởng hàn': 'XH', 'xưởng hoàn thiện': 'XHT', 'site manager': 'SITEMGR',
}
const norm = s => String(s || '').replace(/\s+/g, ' ').trim()

async function main() {
  console.log(COMMIT ? '=== COMMIT MODE (ghi thật) ===' : '=== DRY-RUN (không ghi, thêm --commit để thực thi) ===')

  // 1) Đổi mã QC→QAQC, TBCG→TB (nếu code mới chưa tồn tại)
  for (const [oldC, newC] of Object.entries(RENAME)) {
    const oldD = await p.department.findUnique({ where: { code: oldC } })
    const newD = await p.department.findUnique({ where: { code: newC } })
    if (oldD && !newD) {
      const name = DEPTS.find(d => d[0] === newC)?.[1] || oldD.name
      console.log(`  rename Department ${oldC} → ${newC} ("${name}")`)
      if (COMMIT) await p.department.update({ where: { id: oldD.id }, data: { code: newC, name } })
    }
  }

  // 2) Upsert 16 phòng/xưởng
  for (const [code, name] of DEPTS) {
    const ex = await p.department.findUnique({ where: { code } })
    if (!ex) { console.log(`  + tạo Department ${code} ("${name}")`); if (COMMIT) await p.department.create({ data: { code, name } }) }
    else if (ex.name !== name) { console.log(`  ~ đổi tên ${code}: "${ex.name}" → "${name}"`); if (COMMIT) await p.department.update({ where: { code }, data: { name } }) }
  }
  const deptByCode = new Map((await p.department.findMany({ select: { id: true, code: true } })).map(d => [d.code, d.id]))

  // 3) Đọc Excel: Mã NV → mã dept mới
  const wb = (await import('xlsx')).read(fs.readFileSync('C:/Users/sontt/Downloads/Danh Sách CBCNV tháng 5.26 (1).xlsx'), { type: 'buffer' })
  const rows = (await import('xlsx')).utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
  const kNew = Object.keys(rows[0]).find(k => norm(k).toLowerCase() === 'bộ phận mới')
  const codeByMaNV = new Map(); const unmappedNames = new Set()
  for (const r of rows) {
    const ma = norm(r['Mã NV']); if (!ma) continue
    const dc = NAME_TO_CODE[norm(r[kNew]).toLowerCase()]
    if (dc) codeByMaNV.set(ma, dc); else if (norm(r[kNew])) unmappedNames.add(norm(r[kNew]))
  }
  if (unmappedNames.size) console.log('  ⚠ Bộ phận mới CHƯA map:', [...unmappedNames].join(' | '))

  // 4) Gán lại departmentId cho Employee + User theo Mã NV
  const emps = await p.employee.findMany({ select: { id: true, employeeCode: true, fullName: true, userId: true, departmentId: true } })
  let updated = 0; const byDept = {}; const unmatched = []
  for (const e of emps) {
    const dc = codeByMaNV.get(norm(e.employeeCode))
    if (!dc) { unmatched.push(`${e.employeeCode} ${e.fullName}`); continue }
    byDept[dc] = (byDept[dc] || 0) + 1
    updated++
    if (COMMIT) {
      const deptId = deptByCode.get(dc)
      if (deptId) {
        await p.employee.update({ where: { id: e.id }, data: { departmentId: deptId } })
        if (e.userId) await p.user.update({ where: { id: e.userId }, data: { departmentId: deptId } })
      }
    }
  }
  console.log(`\nEmployee: ${emps.length} | khớp & gán phòng: ${updated} | KHÔNG khớp Mã NV: ${unmatched.length}`)
  console.log('Số người theo phòng mới:', Object.entries(byDept).sort().map(([c, n]) => `${c}:${n}`).join(', '))
  fs.writeFileSync('scripts/_org-unmatched.txt', unmatched.join('\n'))
  console.log('Danh sách không khớp đã ghi: scripts/_org-unmatched.txt (' + unmatched.length + ' người)')

  await p.$disconnect(); await pool.end()
}
main().catch(async e => { console.error(e); await pool.end(); process.exit(1) })
