// ─────────────────────────────────────────────────────────────────────────────
// So lại trạng thái QC của lệnh sản xuất theo kết quả nghiệm thu ITP.
//
// Vì sao cần: từ 2026-08 màn WO bỏ nút "QC Đạt / Không đạt" — kết quả do màn Kế hoạch
// Kiểm tra quyết định. Những ITP đã đạt TRƯỚC khi có luật này không có cú bấm nào để đẩy
// sang WO, nên lệnh kẹt ở "Chờ QC". Script này vá lại một lượt.
//
// Từ nay các lần đọc /api/production và /api/production/[id] tự so lại nên không lặp lại nữa.
//
// Chạy thử:  node scripts/reconcile-wo-qc.mjs
// Chạy thật: node scripts/reconcile-wo-qc.mjs --apply
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const conn = process.env.DATABASE_URL
const isRemote = !conn.includes('@localhost') && !conn.includes('@127.0.0.1')
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: conn, ...(isRemote && { ssl: { rejectUnauthorized: false } }) }),
})

const APPLY = process.argv.includes('--apply')
const OPEN = ['OPEN', 'IN_PROGRESS', 'QC_PENDING', 'QC_FAILED', 'ON_HOLD', 'PENDING_MATERIAL']

const itps = await prisma.inspectionTestPlan.findMany({
  where: { workOrderId: { not: null } },
  select: {
    itpCode: true, status: true, workOrderId: true,
    checkpoints: { select: { status: true } },
    workOrder: { select: { id: true, woCode: true, status: true } },
  },
})

const byWo = new Map()
for (const i of itps) {
  if (!i.workOrder || !OPEN.includes(i.workOrder.status)) continue
  const e = byWo.get(i.workOrderId) || { wo: i.workOrder, cps: [], itps: [] }
  e.cps.push(...i.checkpoints)
  e.itps.push(i.itpCode)
  byWo.set(i.workOrderId, e)
}

const changes = []
for (const [woId, e] of byWo) {
  if (e.cps.length === 0) continue
  let want = null
  if (e.cps.some(c => c.status === 'FAILED')) want = 'QC_FAILED'
  else if (e.cps.every(c => c.status === 'PASSED')) want = 'QC_PASSED'
  if (!want || want === e.wo.status) continue
  changes.push({ woId, woCode: e.wo.woCode, from: e.wo.status, to: want, itps: e.itps.join(',') })
}

console.log(`${APPLY ? 'SỬA' : 'CHẠY THỬ — sẽ sửa'} ${changes.length} lệnh lệch trạng thái:\n`)
for (const c of changes) console.log(`  ${c.woCode}\n     ${c.from} → ${c.to}   (theo ${c.itps})`)

if (!APPLY) {
  console.log('\nChưa ghi gì. Thêm --apply để thực hiện.')
} else {
  for (const c of changes) {
    await prisma.workOrder.update({
      where: { id: c.woId },
      data: c.to === 'QC_PASSED'
        ? { status: 'QC_PASSED', needsReQc: false, reQcReason: null }
        : { status: 'QC_FAILED' },
    })
    await prisma.auditLog.create({
      data: {
        userId: 'system', action: 'TRANSITION', entity: 'WorkOrder', entityId: c.woId,
        changes: { woCode: c.woCode, from: c.from, to: c.to, reason: 'Vá lại theo kết quả nghiệm thu ITP' },
      },
    }).catch(() => {})
  }
  console.log(`\nĐã sửa ${changes.length} lệnh.`)
}

await prisma.$disconnect()
