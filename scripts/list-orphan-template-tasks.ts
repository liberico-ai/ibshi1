/**
 * Liệt kê task OPEN "mồ côi" của template SX-PROD: task có templateStepId
 * mà theo đồ thị ĐÃ SỬA (WORKFLOW_RULES) nó CHƯA NÊN tồn tại — tức bước trước
 * theo next/gate chưa DONE (hệ quả của đồ thị gãy cũ: 7 bước phase 4-5 spawn ngày 1).
 *
 * CHỈ IN BẢNG để rà tay — KHÔNG tự xóa/sửa gì.
 *
 * Một bước được coi là "nên tồn tại" trong dự án khi thỏa 1 trong 3:
 *   (a) entry step (không bước nào next→nó) và gate ⊆ done-set
 *   (b) có bước p đã DONE với p.next chứa nó, và gate ⊆ done-set
 *   (c) gate ≠ rỗng và gate ⊆ done-set (gate-driven spawn)
 * done-set = code các task template DONE + legacy grace: root (orderIndex nhỏ nhất)
 * auto-done nếu root chưa từng spawn (giữ đúng semantics doneCodesForProject).
 *
 * Usage: npx tsx scripts/list-orphan-template-tasks.ts
 */
import pg from 'pg'
import { WORKFLOW_RULES } from '../src/lib/workflow-constants'

if (!process.env.DATABASE_URL) { console.error('❌ DATABASE_URL not set'); process.exit(1) }
const connectionString: string = process.env.DATABASE_URL
const TEMPLATE_CODE = 'SX-PROD'

interface EffStep { id: string; code: string; next: string[]; gate: string[]; orderIndex: number }

async function main() {
  const pool = new pg.Pool({
    connectionString,
    ssl: connectionString.includes('103.141') ? { rejectUnauthorized: false } : undefined,
  })
  console.log(`=== Task mồ côi theo đồ thị ĐÃ SỬA — template ${TEMPLATE_CODE} ===`)
  console.log('DB:', connectionString.replace(/:[^:@/]+@/, ':***@'), '\n')

  const { rows: tpls } = await pool.query(`SELECT id, name FROM workflow_templates WHERE code = $1`, [TEMPLATE_CODE])
  if (tpls.length === 0) { console.error(`❌ Không tìm thấy template '${TEMPLATE_CODE}'`); await pool.end(); process.exit(1) }
  const tplId: string = tpls[0].id

  const { rows: dbSteps } = await pool.query(
    `SELECT id, code, order_index, next_codes, gate_codes FROM template_steps WHERE template_id = $1`, [tplId])

  // Đồ thị "đã sửa": ưu tiên WORKFLOW_RULES; step ngoài rules giữ giá trị DB (đã cảnh báo ở fix script)
  const ruleCodes = Object.keys(WORKFLOW_RULES)
  const steps: EffStep[] = dbSteps.map((s) => {
    const rule = WORKFLOW_RULES[s.code]
    const ruleIdx = ruleCodes.indexOf(s.code)
    return {
      id: s.id, code: s.code,
      next: rule ? (rule.next || []) : (s.next_codes || []),
      gate: rule ? (rule.gate || []) : (s.gate_codes || []),
      orderIndex: ruleIdx >= 0 ? ruleIdx : 1000 + Number(s.order_index),
    }
  })
  const stepById = new Map(steps.map((s) => [s.id, s]))
  const reachable = new Set(steps.flatMap((s) => s.next))
  const root = steps.slice().sort((a, b) => a.orderIndex - b.orderIndex)[0]

  // Toàn bộ task template của SX-PROD (mọi dự án)
  const { rows: tasks } = await pool.query(
    `SELECT t.id, t.status, t.title, t.template_step_id, t.project_id,
            p.project_code, p.project_name
     FROM tasks t
     LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.template_step_id = ANY($1::text[])
     ORDER BY p.project_code, t.created_at`,
    [steps.map((s) => s.id)],
  )

  // Gom theo dự án
  const byProject = new Map<string, typeof tasks>()
  for (const t of tasks) {
    const key = t.project_id || '(no-project)'
    if (!byProject.has(key)) byProject.set(key, [])
    byProject.get(key)!.push(t)
  }

  const orphans: { taskId: string; code: string; title: string; project: string; reason: string }[] = []

  for (const [, projTasks] of byProject) {
    // done-set: DONE thật + legacy grace cho root chưa spawn (khớp doneCodesForProject)
    const done = new Set(
      projTasks.filter((t) => t.status === 'DONE')
        .map((t) => stepById.get(t.template_step_id)?.code)
        .filter((c): c is string => !!c),
    )
    const rootSpawned = root ? projTasks.some((t) => t.template_step_id === root.id) : true
    if (root && !rootSpawned) done.add(root.code)

    const gateOk = (s: EffStep) => s.gate.every((g) => done.has(g))
    const allowed = (s: EffStep): string | null => {
      if (!gateOk(s)) return `gate chưa đủ: cần [${s.gate.filter((g) => !done.has(g)).join(', ')}]`
      const isEntry = !reachable.has(s.code)
      const hasDonePred = steps.some((p) => done.has(p.code) && p.next.includes(s.code))
      const gateDriven = s.gate.length > 0 // gateOk đã kiểm ở trên
      if (isEntry || hasDonePred || gateDriven) return null
      const preds = steps.filter((p) => p.next.includes(s.code)).map((p) => p.code)
      return `chưa có bước trước DONE (cần một trong: ${preds.join(', ') || '—'})`
    }

    for (const t of projTasks) {
      if (t.status !== 'OPEN') continue // chỉ rà task OPEN
      const s = stepById.get(t.template_step_id)
      if (!s) continue
      const why = allowed(s)
      if (why) {
        orphans.push({
          taskId: t.id, code: s.code, title: t.title,
          project: t.project_code ? `${t.project_code} — ${t.project_name || ''}` : '(không có dự án)',
          reason: why,
        })
      }
    }
  }

  if (orphans.length === 0) {
    console.log('✅ Không có task OPEN mồ côi theo đồ thị đã sửa.')
  } else {
    console.log(`⚠️  ${orphans.length} task OPEN chưa nên tồn tại (rà tay, KHÔNG tự xóa):\n`)
    const w = { id: 28, code: 8, title: 44, proj: 34 }
    console.log(
      'taskId'.padEnd(w.id), 'code'.padEnd(w.code), 'title'.padEnd(w.title), 'project'.padEnd(w.proj), 'lý do')
    console.log('-'.repeat(w.id + w.code + w.title + w.proj + 30))
    for (const o of orphans) {
      console.log(
        o.taskId.padEnd(w.id),
        o.code.padEnd(w.code),
        (o.title.length > w.title - 2 ? o.title.slice(0, w.title - 3) + '…' : o.title).padEnd(w.title),
        (o.project.length > w.proj - 2 ? o.project.slice(0, w.proj - 3) + '…' : o.project).padEnd(w.proj),
        o.reason,
      )
    }
  }

  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
