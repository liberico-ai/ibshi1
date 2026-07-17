/**
 * F3 — Backfill Budget 4 nhóm từ dự toán (form ESTIMATE P1.2) cho các dự án CHƯA từng sync.
 *
 * Bối cảnh: `syncEstimateToBudget` chỉ chạy khi task ESTIMATE hoàn thành (hook trong work-engine).
 * Dự án có task hoàn thành TRƯỚC khi có hook (hoặc data import trực tiếp) → Budget 4 nhóm = 0
 * dù dự toán đã có → kế toán không thấy số ở màn Dòng tiền.
 *
 * DIỆN BACKFILL (cả 3 điều kiện):
 *   1) Có task ESTIMATE (P1.2) trạng thái COMPLETED  ← cổng an toàn: KHÔNG đụng dự toán chưa chốt
 *   2) extractEstimateTotals(resultData) ra totals > 0
 *   3) Budget 4 nhóm (project-scoped, month/year = null) hiện đang thiếu/0
 *
 * An toàn:
 *   - DRY-RUN là MẶC ĐỊNH (chỉ đọc + in bảng). Ghi chỉ khi truyền --apply.
 *   - TÁI DÙNG maybeSyncEstimateToBudget (work-hooks) → syncEstimateToBudget (sync-engine).
 *     KHÔNG viết logic sync mới. Sync là recompute-set ⇒ idempotent, chạy lại không nhân đôi.
 *
 * ⚠️ DATABASE_URL quyết định DB đích — script IN RA host/db trước khi chạy. Kiểm kỹ trước --apply.
 *
 * Chạy:
 *   npx tsx scripts/backfill-estimate-budget.ts              # DRY-RUN (mặc định, không mutate)
 *   npx tsx scripts/backfill-estimate-budget.ts --apply      # GHI (sau khi duyệt danh sách dry-run)
 *   npx tsx scripts/backfill-estimate-budget.ts --json       # xuất JSON (để dựng báo cáo)
 */
import 'dotenv/config'
import prisma from '../src/lib/db'
import { extractEstimateTotals, maybeSyncEstimateToBudget } from '../src/lib/work-hooks'

const APPLY = process.argv.includes('--apply')
const AS_JSON = process.argv.includes('--json')

const ESTIMATE_STEP = 'P1.2'
const BUDGET_CATEGORIES = ['MATERIAL', 'LABOR', 'SERVICE', 'OVERHEAD'] as const
const KEY_TO_CAT: Record<string, string> = {
  totalMaterial: 'MATERIAL', totalLabor: 'LABOR', totalService: 'SERVICE', totalOverhead: 'OVERHEAD',
}

type Row = {
  projectCode: string
  projectId: string
  taskStatus: string
  totals: Record<string, number>
  budgetNow: Record<string, number>
  willWrite: Record<string, number>
  verdict: 'BACKFILL' | 'SKIP_BUDGET_DA_CO' | 'SKIP_KHONG_TOTALS'
}

function fmt(n: number) { return n.toLocaleString('vi-VN') }
function dbTarget() {
  const u = process.env.DATABASE_URL || '(chưa set)'
  return u.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@')
}

async function main() {
  console.log(`\n[backfill-estimate-budget] chế độ: ${APPLY ? '⚠️  APPLY (SẼ GHI)' : 'DRY-RUN (chỉ đọc)'}`)
  console.log(`[backfill-estimate-budget] DATABASE_URL → ${dbTarget()}\n`)

  // 1) Mọi task ESTIMATE P1.2 (mọi trạng thái) — để phân loại completed vs chưa
  const p12Tasks = await prisma.task.findMany({
    where: { taskType: ESTIMATE_STEP, projectId: { not: null } },
    select: { projectId: true, status: true, resultData: true, completedAt: true },
    orderBy: { completedAt: 'desc' },
  })

  // 1 task mới nhất / project (giống fetchStepResult: orderBy completedAt desc, lấy đầu)
  const latestByProject = new Map<string, (typeof p12Tasks)[number]>()
  for (const t of p12Tasks) {
    if (t.projectId && !latestByProject.has(t.projectId)) latestByProject.set(t.projectId, t)
  }

  const projects = await prisma.project.findMany({
    where: { id: { in: [...latestByProject.keys()] } },
    select: { id: true, projectCode: true, projectName: true },
  })
  const codeById = new Map(projects.map(p => [p.id, p.projectCode]))

  const rows: Row[] = []
  const notCompleted: { projectCode: string; status: string; hasTotals: boolean }[] = []

  for (const [projectId, task] of latestByProject) {
    const projectCode = codeById.get(projectId) || projectId
    const totals = extractEstimateTotals(task.resultData as Record<string, unknown> | null)

    // Cổng an toàn: chỉ backfill khi task ESTIMATE đã COMPLETED
    if (task.status !== 'COMPLETED') {
      notCompleted.push({ projectCode, status: task.status, hasTotals: !!totals })
      continue
    }
    if (!totals) {
      rows.push({ projectCode, projectId, taskStatus: task.status, totals: {}, budgetNow: {}, willWrite: {}, verdict: 'SKIP_KHONG_TOTALS' })
      continue
    }

    const budgetRows = await prisma.budget.findMany({
      where: { projectId, month: null, year: null },
      select: { category: true, planned: true },
    })
    const budgetNow: Record<string, number> = {}
    for (const c of BUDGET_CATEGORIES) {
      const r = budgetRows.find(b => b.category === c)
      budgetNow[c] = r ? Number(r.planned) : 0
    }

    const willWrite: Record<string, number> = {}
    for (const [key, val] of Object.entries(totals)) {
      const cat = KEY_TO_CAT[key]
      if (cat && Number(val) > 0) willWrite[cat] = Number(val)
    }

    // Budget đã có số ở MỌI nhóm mà dự toán sẽ ghi → không cần backfill
    const budgetTotal = BUDGET_CATEGORIES.reduce((s, c) => s + budgetNow[c], 0)
    const verdict: Row['verdict'] = budgetTotal > 0 ? 'SKIP_BUDGET_DA_CO' : 'BACKFILL'

    rows.push({ projectCode, projectId, taskStatus: task.status, totals: totals as Record<string, number>, budgetNow, willWrite, verdict })
  }

  const toBackfill = rows.filter(r => r.verdict === 'BACKFILL')

  if (AS_JSON) {
    console.log(JSON.stringify({ dbTarget: dbTarget(), apply: APPLY, rows, notCompleted }, null, 2))
  } else {
    console.log(`=== DIỆN BACKFILL (${toBackfill.length} dự án) — ESTIMATE COMPLETED + totals>0 + Budget 4 nhóm = 0 ===`)
    for (const r of toBackfill) {
      console.log(`\n  ${r.projectCode}`)
      console.log(`    dự toán (totals): ${BUDGET_CATEGORIES.map(c => `${c}=${fmt(r.willWrite[c] || 0)}`).join(' ')}`)
      console.log(`    Budget hiện tại : ${BUDGET_CATEGORIES.map(c => `${c}=${fmt(r.budgetNow[c])}`).join(' ')}`)
      console.log(`    ⟹ SẼ GHI       : ${Object.entries(r.willWrite).map(([c, v]) => `${c}=${fmt(v)}`).join(' ')}`)
    }
    const skipped = rows.filter(r => r.verdict !== 'BACKFILL')
    console.log(`\n=== BỎ QUA (${skipped.length}) ===`)
    skipped.forEach(r => console.log(`  ${r.projectCode}: ${r.verdict === 'SKIP_BUDGET_DA_CO' ? 'Budget đã có số' : 'dự toán không có totals>0'}`))
    console.log(`\n=== LOẠI RA — ESTIMATE CHƯA COMPLETED (${notCompleted.length}) — KHÔNG đụng ===`)
    notCompleted.forEach(n => console.log(`  ${n.projectCode}: task ${ESTIMATE_STEP} status=${n.status}${n.hasTotals ? ' (CÓ totals nhưng chưa chốt → không sync)' : ''}`))
  }

  if (!APPLY) {
    console.log(`\n[DRY-RUN] KHÔNG ghi gì. Duyệt danh sách trên rồi chạy lại với --apply.\n`)
    return
  }

  // ── APPLY ──
  const admin = await prisma.user.findFirst({ where: { roleCode: 'R01' }, select: { id: true, fullName: true } })
  if (!admin) { console.error('✗ Không tìm thấy user R01 để gán triggeredBy — dừng.'); process.exitCode = 1; return }
  console.log(`\n[APPLY] triggeredBy = ${admin.fullName} (${admin.id})`)

  let ok = 0, fail = 0
  for (const r of toBackfill) {
    const task = latestByProject.get(r.projectId)!
    try {
      // TÁI DÙNG đường sync thật (idempotent recompute-set) — không viết logic mới
      await maybeSyncEstimateToBudget(r.projectId, admin.id, task.resultData as Record<string, unknown> | null)
      const after = await prisma.budget.findMany({
        where: { projectId: r.projectId, month: null, year: null },
        select: { category: true, planned: true },
      })
      const tot = after.reduce((s, b) => s + Number(b.planned), 0)
      console.log(`  ✓ ${r.projectCode}: Budget Σ = ${fmt(tot)}`)
      ok++
    } catch (e) {
      console.error(`  ✗ ${r.projectCode}:`, e instanceof Error ? e.message : e)
      fail++
    }
  }
  console.log(`\n[APPLY] xong: ${ok} OK, ${fail} lỗi.\n`)
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
