// Prisma 7 ở repo này bắt buộc driver adapter → dùng prisma singleton của app (@/lib/db)
// đã cấu hình PrismaPg + ssl remote + đọc DATABASE_URL. (new PrismaClient() thô sẽ lỗi.)
import { prisma } from '@/lib/db'
import { readFileSync } from 'fs'
const APPLY = process.argv.includes('--apply') // mặc định dry-run

function parseCsv(path: string) {
  const lines = readFileSync(path, 'utf8').trim().split(/\r?\n/)
  const head = lines[0].split(',')
  return lines.slice(1).map(l => {
    // parse có xét dấu ngoặc kép
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
  const csvPath = process.argv.find(a => a.startsWith('--csv='))?.slice(6) ?? 'docs/handoff/username_phone_mapping.csv'
  const rows = parseCsv(csvPath).filter(r => r.status === 'OK')
  console.log(`CSV: ${csvPath}`)
  console.log(`Rows OK: ${rows.length} | Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`)

  // Tiền kiểm: unique new_username + không rỗng + không trùng username hiện có (của user khác)
  const seen = new Set<string>()
  for (const r of rows) {
    if (!/^0\d{9}$/.test(r.new_username)) throw new Error(`SĐT không hợp lệ: ${r.userId} ${r.new_username}`)
    if (seen.has(r.new_username)) throw new Error(`Trùng SĐT trong mapping: ${r.new_username}`)
    seen.add(r.new_username)
  }
  const clash = await prisma.user.findMany({
    where: { username: { in: rows.map(r => r.new_username) }, id: { notIn: rows.map(r => r.userId) } },
    select: { username: true },
  })
  if (clash.length) throw new Error(`SĐT trùng username user khác: ${clash.map(c => c.username).join(', ')}`)

  let changed = 0, skipped = 0, notfound = 0
  await prisma.$transaction(async (tx) => {
    for (const r of rows) {
      const u = await tx.user.findUnique({ where: { id: r.userId }, select: { username: true } })
      if (!u) { console.warn(`  ✗ NOT FOUND ${r.userId} ${r.fullName}`); notfound++; continue }
      if (u.username === r.new_username) { skipped++; continue } // idempotent
      console.log(`  ${u.username}  →  ${r.new_username}   (${r.fullName})`)
      if (APPLY) await tx.user.update({ where: { id: r.userId }, data: { username: r.new_username } })
      changed++
    }
    if (!APPLY) throw new Error('DRY-RUN rollback (chạy lại với --apply để ghi)')
    // timeout/maxWait nới rộng: 127 dòng × query qua DB remote vượt mặc định 5s của Prisma.
  }, { maxWait: 15000, timeout: 180000 }).catch(e => { if (!String(e.message).includes('DRY-RUN')) throw e })

  console.log(`\nĐổi: ${changed} | Bỏ qua (đã đúng): ${skipped} | Không thấy: ${notfound}`)
}
main().finally(() => prisma.$disconnect())
