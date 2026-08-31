// ─────────────────────────────────────────────────────────────────────────────
// Huỷ mềm các task thuộc bước Phase 5 đã GỠ khỏi quy trình (rút gọn 2026-08):
//   P5.1   Báo cáo khối lượng nội bộ theo NGÀY
//   P5.1A  Báo cáo khối lượng thầu phụ theo NGÀY
//   P5.1.1 Yêu cầu nghiệm thu chất lượng hạng mục
//   P5.3A  QAQC nghiệm thu chất lượng hạng mục
//
// Quy trình mới: P4.5 → P5.2 (xưởng báo KL tuần) → P5.3 (TP QAQC) ∥ P5.4 (PM) → P5.5.
//
// KHÔNG xoá dữ liệu: chỉ chuyển status sang CANCELLED và ghi lý do vào resultData._retired.
// Số liệu đã nhập trong các task đó vẫn nằm nguyên trong DB.
//
// Chạy thử (không ghi):  node scripts/cancel-retired-p5-tasks.mjs
// Chạy thật:             node scripts/cancel-retired-p5-tasks.mjs --apply
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const conn = process.env.DATABASE_URL
const isRemote = !conn.includes('@localhost') && !conn.includes('@127.0.0.1')
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: conn, ...(isRemote && { ssl: { rejectUnauthorized: false } }) }),
})

const RETIRED = ['P5.1', 'P5.1A', 'P5.1.1', 'P5.3A']
const APPLY = process.argv.includes('--apply')

const tasks = await prisma.task.findMany({
  where: { taskType: { in: RETIRED }, status: { notIn: ['CANCELLED', 'DONE'] } },
  select: {
    id: true, taskType: true, title: true, status: true, resultData: true,
    project: { select: { projectCode: true } },
  },
  orderBy: [{ taskType: 'asc' }, { createdAt: 'asc' }],
})

console.log(`${APPLY ? 'HUỶ' : 'CHẠY THỬ — sẽ huỷ'} ${tasks.length} task thuộc bước đã gỡ:\n`)
const byType = {}
for (const t of tasks) {
  byType[t.taskType] = (byType[t.taskType] || 0) + 1
  console.log(`  ${t.taskType.padEnd(7)} ${(t.project?.projectCode || '—').padEnd(18)} [${t.status}] ${t.title}`)
}
console.log('\nTổng theo bước:', JSON.stringify(byType))

// Task đã DONE thì để nguyên — chúng là lịch sử hợp lệ.
const done = await prisma.task.count({ where: { taskType: { in: RETIRED }, status: 'DONE' } })
console.log(`Giữ nguyên ${done} task đã hoàn thành (lịch sử).`)

if (!APPLY) {
  console.log('\nChưa ghi gì. Thêm --apply để thực hiện.')
} else {
  let n = 0
  for (const t of tasks) {
    const rd = (t.resultData && typeof t.resultData === 'object') ? t.resultData : {}
    await prisma.task.update({
      where: { id: t.id },
      data: {
        status: 'CANCELLED',
        resultData: { ...rd, _retired: 'Bước đã gỡ khỏi quy trình (rút gọn Phase 5, 2026-08)' },
      },
    })
    n++
  }
  console.log(`\nĐã huỷ ${n} task.`)
}

await prisma.$disconnect()
