/**
 * Kiểm (và sửa) tiêu đề công việc thuộc quy trình 32 bước.
 *
 * VÌ SAO CÓ FILE NÀY
 *   Trang Dự án trước đây lấy TIÊU ĐỀ TASK làm tên bước. Việc tạo tay mượn nhãn mã bước
 *   (P2.1 = "Đề xuất/yêu cầu vật tư", P1.1B = "Yêu cầu phê duyệt"…) nên nhảy vào khung
 *   32 bước, hiện "Xong" oan và thay luôn tên bước.
 *
 *   Phần HIỂN THỊ đã sửa trong code: tên bước luôn lấy từ quy trình, việc tạo tay tách ra
 *   mục "Việc ngoài quy trình". KHÔNG cần sửa dữ liệu để trang Dự án hiện đúng.
 *
 *   File này chỉ để dọn nốt phần còn lại: vài task THUỘC quy trình được tạo từ trước khi
 *   đổi tên bước, nên mở trang chi tiết task vẫn thấy tên cũ. Sửa hay không tuỳ bạn.
 *
 * CÁCH DÙNG
 *   node scripts/check-step-titles.mjs            → chỉ liệt kê, KHÔNG đổi gì
 *   node scripts/check-step-titles.mjs --fix      → đổi tiêu đề task về đúng tên bước
 *
 *   Chạy trên máy chủ nào thì đặt DATABASE_URL của máy chủ đó trong .env.
 *   Xem đang trỏ vào đâu: script in host + tên database ở dòng đầu.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const FIX = process.argv.includes('--fix')
const url = process.env.DATABASE_URL
if (!url) { console.error('Thiếu DATABASE_URL trong .env'); process.exit(1) }

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url, ssl: { rejectUnauthorized: false } }),
})

const u = new URL(url)
console.log(`CSDL: ${u.hostname} / ${u.pathname.slice(1)}`)
console.log(FIX ? 'CHẾ ĐỘ: SỬA THẬT\n' : 'CHẾ ĐỘ: chỉ xem, không đổi gì (thêm --fix để sửa)\n')

// ── 1. Task THUỘC quy trình nhưng tiêu đề lệch tên bước ──
const steps = await prisma.templateStep.findMany({ select: { id: true, code: true, title: true } })
const stepById = new Map(steps.map(s => [s.id, s]))

const flow = await prisma.task.findMany({
  where: { templateStepId: { not: null } },
  select: { id: true, title: true, templateStepId: true, project: { select: { projectCode: true } } },
})
const diverged = flow.filter(t => {
  const st = stepById.get(t.templateStepId)
  return st && t.title !== st.title
})

console.log(`1) Task thuộc quy trình có tiêu đề lệch tên bước: ${diverged.length}/${flow.length}`)
for (const t of diverged) {
  const st = stepById.get(t.templateStepId)
  console.log(`   ${(t.project?.projectCode || '—').padEnd(18)} ${st.code.padEnd(7)}`)
  console.log(`       hiện tại : "${t.title}"`)
  console.log(`       tên bước : "${st.title}"`)
}
if (FIX && diverged.length > 0) {
  for (const t of diverged) {
    await prisma.task.update({ where: { id: t.id }, data: { title: stepById.get(t.templateStepId).title } })
  }
  console.log(`   → Đã sửa ${diverged.length} tiêu đề.`)
}

// ── 2. Việc tạo tay mượn nhãn mã bước (KHÔNG sửa — đây là tính năng có chủ ý) ──
const adhoc = await prisma.task.findMany({
  where: { templateStepId: null },
  select: { taskType: true, title: true, status: true, project: { select: { projectCode: true } } },
})
const borrowed = adhoc.filter(t => /^P\d/.test(t.taskType || ''))
console.log(`\n2) Việc tạo tay mượn nhãn mã bước: ${borrowed.length}`)
console.log('   (KHÔNG sửa — màn "Tạo việc" cố ý dùng mã bước làm nhãn loại việc để thừa hưởng')
console.log('    định tuyến và biểu mẫu. Trang Dự án đã tách chúng sang mục "Việc ngoài quy trình".)')
const byType = new Map()
for (const t of borrowed) byType.set(t.taskType, (byType.get(t.taskType) || 0) + 1)
for (const [k, v] of [...byType.entries()].sort()) console.log(`   ${k.padEnd(8)} ${v} việc`)

// ── 3. So tên bước trong CSDL với tên trong code ──
console.log('\n3) Tên bước trong CSDL so với workflow-constants.ts:')
const { WORKFLOW_RULES } = await import('../src/lib/workflow-constants.ts').catch(() => ({ WORKFLOW_RULES: null }))
if (!WORKFLOW_RULES) {
  console.log('   (không nạp được file .ts từ node — bỏ qua; dùng `npx vitest` nếu cần đối chiếu)')
} else {
  const lech = steps.filter(s => WORKFLOW_RULES[s.code] && WORKFLOW_RULES[s.code].name !== s.title)
  console.log(lech.length === 0 ? '   Khớp toàn bộ.' : `   Lệch ${lech.length} bước:`)
  for (const s of lech) console.log(`   ${s.code.padEnd(7)} DB="${s.title}"  CODE="${WORKFLOW_RULES[s.code].name}"`)
}

await prisma.$disconnect()
