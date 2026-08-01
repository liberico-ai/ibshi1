/**
 * "Về hưu" (retire) 2 bước workflow LEGACY khỏi luồng — chuyển hẳn sang SIDEBAR:
 *   • P4.3 — QC nghiệm thu chất lượng nhập kho
 *   • P4.4 — Kho nghiệm thu số lượng và nhập kho
 *
 * Luồng mới: Hàng về (TM) → QC nghiệm thu (sidebar) → Kho nhập kho (sidebar), theo PO đã về.
 *
 * Script làm 2 việc:
 *   (A) VÔ HIỆU HÓA TemplateStep P4.3/P4.4 trong DB — ĐÂY LÀ GỐC RỄ khiến task tự sinh.
 *       Vì spawn task đọc gateCodes/nextCodes từ DB (chainNextTemplateTasks), KHÔNG từ code.
 *       - Xoá 'P4.3'/'P4.4' khỏi nextCodes & gateCodes của MỌI step (mọi template).
 *       - Xoá gateCodes của chính step P4.3/P4.4 (để gate-driven spawn bỏ qua chúng).
 *       → Sau đó P4.3/P4.4 KHÔNG BAO GIỜ còn được spawn. (Không XOÁ record để tránh vướng FK.)
 *   (B) HUỶ MỀM các task P4.3/P4.4 đang mở còn sót (OPEN/IN_PROGRESS/RETURNED/AWAITING_REVIEW).
 *
 * AN TOÀN: mặc định DRY-RUN. Thêm --apply để ghi. Yêu cầu DATABASE_URL.
 *   npx tsx scripts/cancel-legacy-qc-warehouse-tasks.ts            # xem trước
 *   npx tsx scripts/cancel-legacy-qc-warehouse-tasks.ts --apply     # thực thi
 */
import 'dotenv/config'
import prisma from '../src/lib/db'

const APPLY = process.argv.includes('--apply')
const CODES = ['P4.3', 'P4.4']
const OPEN_STATUSES = ['OPEN', 'IN_PROGRESS', 'RETURNED', 'AWAITING_REVIEW']

function without(arr: string[] | null | undefined): string[] {
  return (arr || []).filter((c) => !CODES.includes(c))
}

async function neutralizeTemplateSteps() {
  console.log('\n── (A) Vô hiệu hóa TemplateStep P4.3/P4.4 trong DB ──')
  const all = await prisma.templateStep.findMany({ select: { id: true, code: true, nextCodes: true, gateCodes: true, templateId: true } })

  const affected = all.filter((s) =>
    CODES.includes(s.code) ||
    (s.nextCodes || []).some((c) => CODES.includes(c)) ||
    (s.gateCodes || []).some((c) => CODES.includes(c)),
  )
  console.log(`Step cần chỉnh: ${affected.length}`)
  for (const s of affected) {
    const isTarget = CODES.includes(s.code)
    const newNext = without(s.nextCodes)
    const newGate = isTarget ? [] : without(s.gateCodes)   // step P4.3/P4.4: xoá luôn gate của chính nó → không gate-driven spawn
    console.log(`  ${s.code}: next ${JSON.stringify(s.nextCodes)}→${JSON.stringify(newNext)} | gate ${JSON.stringify(s.gateCodes)}→${JSON.stringify(newGate)}`)
    if (APPLY) {
      await prisma.templateStep.update({ where: { id: s.id }, data: { nextCodes: newNext, gateCodes: newGate } })
    }
  }
}

async function cancelOpenTasks() {
  console.log('\n── (B) Huỷ mềm task P4.3/P4.4 đang mở ──')
  const tasks = await prisma.task.findMany({
    where: { taskType: { in: CODES }, status: { in: OPEN_STATUSES } },
    select: { id: true, taskType: true, status: true, title: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`Task đang mở: ${tasks.length}`)
  for (const t of tasks) console.log(`  [${t.taskType}/${t.status}] ${t.title} (${t.id})`)
  if (!APPLY) return
  for (const t of tasks) {
    await prisma.task.update({ where: { id: t.id }, data: { status: 'CANCELLED' } })
    try {
      await prisma.taskHistory.create({ data: { taskId: t.id, action: 'CANCELLED', byUserId: 'system', reason: 'Retire P4.3/P4.4 — chuyển sang luồng sidebar (Hàng về → QC → Kho)' } })
    } catch { /* lịch sử không bắt buộc */ }
  }
  console.log(`✅ Đã huỷ mềm ${tasks.length} task.`)
}

async function main() {
  await neutralizeTemplateSteps()
  await cancelOpenTasks()
  if (!APPLY) console.log('\n⚠️  DRY-RUN — chưa ghi gì. Thêm --apply để thực thi thật.')
  else console.log('\n✅ HOÀN TẤT — P4.3/P4.4 đã về hưu; không còn spawn task mới.')
}
main().then(() => process.exit(0)).catch((e) => { console.error('LỖI:', e); process.exit(1) })
