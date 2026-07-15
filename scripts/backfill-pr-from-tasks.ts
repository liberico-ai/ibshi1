// ══════════════════════════════════════════════════════════════
// BACKFILL PR từ Task.resultData (bước 4/5 — PHUONGAN_NoiLuongPR)
//
// DRY-RUN mặc định (không ghi gì). Thêm --apply để ghi.
// Idempotent: sourceTaskId unique → chạy lại không nhân bản.
// Chỉ materialize task allowlisted (P2.1/P2.2/P2.3 hoặc FREE) — dùng lại
// normalizePrLines + isTaskTypeAllowedForPr đã có.
//
// GUARD "mã lệch dự án": với mỗi task, so số dự án suy từ mã vật tư (I104-*)
// với số dự án của task. >50% dòng-có-mã mang số KHÁC → NGHI, LOẠI khỏi apply.
// Tổng quát hoá vụ I-111/I104.
//
// Chạy:
//   DATABASE_URL=... npx tsx scripts/backfill-pr-from-tasks.ts            # dry-run
//   DATABASE_URL=... npx tsx scripts/backfill-pr-from-tasks.ts --apply    # ghi (bỏ task nghi)
//   ... --force <taskId>   # ép materialize 1 task đã xác nhận dù bị guard đánh dấu
// ══════════════════════════════════════════════════════════════
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { normalizePrLines } from '../src/lib/pr-normalizer'
import { isTaskTypeAllowedForPr, maybeMaterializePr } from '../src/lib/pr-materialize'

const APPLY = process.argv.includes('--apply')
const FORCE_IDS = new Set(
  process.argv.flatMap((a, i) => (a === '--force' ? [process.argv[i + 1]] : [])).filter(Boolean),
)
const MISMATCH_THRESHOLD = 0.5

/** Số dự án suy từ chuỗi: "26-WNC-I-111" → 111 · "26-BRA-I-090" → 90 · không có → null */
function projNum(code: string | null | undefined): number | null {
  const m = String(code ?? '').match(/I-?0*(\d+)\s*$/)
  return m ? parseInt(m[1], 10) : null
}
/** Số dự án suy từ mã vật tư: "I104-VTC01" → 104 · "I90-A1" → 90 · "1"/tiêu hao → null */
function itemNum(code: string | null | undefined): number | null {
  const m = String(code ?? '').match(/^I0*(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

interface GuardResult { suspicious: boolean; codedLines: number; mismatchLines: number; taskProj: number | null; topOtherProj: number | null }

function runGuard(projectCode: string, lines: { itemCode?: string }[]): GuardResult {
  const taskProj = projNum(projectCode)
  let codedLines = 0, mismatchLines = 0
  const otherCount: Record<number, number> = {}
  for (const l of lines) {
    const inum = itemNum(l.itemCode)
    if (inum === null) continue // dòng không có mã dự án (tiêu hao) → trung tính
    codedLines++
    if (taskProj !== null && inum !== taskProj) {
      mismatchLines++
      otherCount[inum] = (otherCount[inum] || 0) + 1
    }
  }
  const topOtherProj = Object.entries(otherCount).sort((a, b) => b[1] - a[1])[0]?.[0]
  const suspicious =
    taskProj !== null && codedLines > 0 && mismatchLines / codedLines > MISMATCH_THRESHOLD
  return { suspicious, codedLines, mismatchLines, taskProj, topOtherProj: topOtherProj ? parseInt(topOtherProj) : null }
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Thiếu DATABASE_URL')
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  // Bật flag TRONG process này để maybeMaterializePr chịu ghi (không đụng env container).
  if (APPLY) process.env.FF_PR_MATERIALIZE = 'true'

  const tasks = await prisma.task.findMany({
    where: { resultData: { not: null } },
    select: { id: true, title: true, taskType: true, projectId: true, resultData: true,
      project: { select: { projectCode: true } }, createdBy: true },
  })

  const willCreate: { id: string; pc: string; tt: string; title: string; lines: number }[] = []
  const suspicious: { id: string; pc: string; tt: string; title: string; lines: number; g: GuardResult }[] = []
  let scanned = 0, skippedNoLines = 0, skippedNotAllowed = 0

  for (const t of tasks) {
    const lines = normalizePrLines(t.resultData)
    if (lines.length === 0) { skippedNoLines++; continue }
    scanned++
    if (!isTaskTypeAllowedForPr(t.taskType)) { skippedNotAllowed++; continue }

    const pc = t.project?.projectCode ?? '(không DA)'
    const g = runGuard(pc, lines)
    const forced = FORCE_IDS.has(t.id)
    if (g.suspicious && !forced) {
      suspicious.push({ id: t.id, pc, tt: t.taskType, title: t.title, lines: lines.length, g })
    } else {
      willCreate.push({ id: t.id, pc, tt: t.taskType, title: t.title, lines: lines.length })
    }
  }

  console.log(`\n═══ BACKFILL PR ${APPLY ? '(APPLY — GHI)' : '(DRY-RUN)'} ═══`)
  console.log(`Task có dòng PR: ${scanned} | bỏ (không allowlist, vd P3.5): ${skippedNotAllowed} | bỏ (không có dòng): ${skippedNoLines}`)

  console.log(`\n── SẼ MATERIALIZE: ${willCreate.length} task ──`)
  for (const w of willCreate) console.log(`  ✅ ${w.pc.padEnd(14)} ${w.tt.padEnd(5)} ${String(w.lines).padStart(4)} dòng  ${w.title.slice(0, 36)}`)

  console.log(`\n── ⚠️  GUARD LOẠI (mã lệch dự án > ${MISMATCH_THRESHOLD * 100}%): ${suspicious.length} task ──`)
  if (suspicious.length === 0) console.log('  (không có)')
  for (const s of suspicious)
    console.log(`  🚩 ${s.pc.padEnd(14)} ${s.tt.padEnd(5)} ${s.g.mismatchLines}/${s.g.codedLines} dòng mã dự án ${s.g.topOtherProj} (task thuộc ${s.g.taskProj})  ${s.title.slice(0, 32)}`)

  if (!APPLY) {
    console.log(`\n(DRY-RUN — chưa ghi gì. Thêm --apply để materialize ${willCreate.length} task sạch.)`)
    await prisma.$disconnect(); await pool.end(); return
  }

  console.log(`\n── ĐANG GHI ${willCreate.length} task ──`)
  let created = 0, updated = 0, items = 0, failed = 0
  for (const w of willCreate) {
    const r = await maybeMaterializePr(w.id, w.id === '' ? '' : (tasks.find(t => t.id === w.id)?.createdBy ?? ''))
    if (r.materialized) { r.created ? created++ : updated++; items += r.lineCount }
    else { failed++; console.log(`  ⚠️ ${w.pc} ${w.tt}: không ghi (${r.reason})`) }
  }
  console.log(`\nKẾT QUẢ: tạo ${created} PR · cập nhật ${updated} PR · ${items} dòng item · lỗi/bỏ ${failed}`)

  const total = await prisma.purchaseRequest.count()
  console.log(`purchase_requests hiện có: ${total}`)
  await prisma.$disconnect(); await pool.end()
}
main().catch(e => { console.error('LỖI:', e.message); process.exit(1) })
