/**
 * Dọn task rác của dự án test ZZ-FLOW-TEST-001 (sinh sớm do bug thứ tự spawn
 * trong applyTemplate: doneCodesForProject chạy TRƯỚC khi spawn entry → legacy
 * grace coi root "đã xong" → pass chain sinh P1.1B (và các bước phase 4-5 khi
 * đồ thị template còn gãy) ngay ngày 1).
 *
 * XÓA: task có templateStepId trỏ tới step code IN
 *   ('P1.1B','P4.3','P4.5','P5.1','P5.1A','P5.1.1','P5.2','P5.5')
 *   VÀ status ∈ (OPEN, IN_PROGRESS) VÀ result_data IS NULL (chưa ai nhập gì).
 * GIỮ: P1.1 (entry hợp lệ) và mọi task đã có resultData / đã DONE.
 *
 * AN TOÀN:
 *  - Chỉ đụng dự án projectCode='ZZ-FLOW-TEST-001' — không dự án nào khác.
 *  - Xóa con trước (task_doc_acks → task_doc_requirements, task_assignees,
 *    task_history) rồi mới xóa tasks — không phụ thuộc ON DELETE CASCADE của DB.
 *  - Task có children/forwards trỏ tới → BỎ QUA + cảnh báo (không phá cây).
 *  - In danh sách đầy đủ trước khi xóa. Dry-run mặc định.
 *
 * Usage:
 *   npx tsx scripts/cleanup-zz-flow-test-tasks.ts            # dry-run (mặc định, chỉ in)
 *   npx tsx scripts/cleanup-zz-flow-test-tasks.ts --apply    # xóa thật
 */
import pg from 'pg'

if (!process.env.DATABASE_URL) { console.error('❌ DATABASE_URL not set'); process.exit(1) }
const connectionString: string = process.env.DATABASE_URL
const APPLY = process.argv.includes('--apply')

const PROJECT_CODE = 'ZZ-FLOW-TEST-001'
// GIỮ P1.1 — chỉ xóa các bước bị spawn sớm/sai
const STEP_CODES = ['P1.1B', 'P4.3', 'P4.5', 'P5.1', 'P5.1A', 'P5.1.1', 'P5.2', 'P5.5']
const STATUSES = ['OPEN', 'IN_PROGRESS']

interface Victim {
  id: string
  title: string
  status: string
  step_code: string
  created_at: Date
  n_children: number
  n_forwards: number
}

async function main() {
  const pool = new pg.Pool({
    connectionString,
    ssl: connectionString.includes('103.141') ? { rejectUnauthorized: false } : undefined,
  })
  console.log(`=== Cleanup task test ${PROJECT_CODE} — ${APPLY ? 'APPLY' : 'DRY-RUN'} ===`)
  console.log('DB:', connectionString.replace(/:[^:@/]+@/, ':***@'))

  const { rows: projects } = await pool.query(
    `SELECT id, project_code, project_name FROM projects WHERE project_code = $1`, [PROJECT_CODE])
  if (projects.length === 0) {
    console.error(`❌ Không tìm thấy dự án projectCode='${PROJECT_CODE}'`)
    await pool.end(); process.exit(1)
  }
  const project = projects[0]
  console.log(`Dự án: ${project.project_code} — ${project.project_name} (id=${project.id})\n`)

  // Tìm task cần xóa + đếm task con / task forward trỏ tới (nếu có → không xóa)
  const { rows: victims } = await pool.query<Victim>(
    `SELECT t.id, t.title, t.status, ts.code AS step_code, t.created_at,
            (SELECT COUNT(*) FROM tasks c WHERE c.parent_id = t.id)::int AS n_children,
            (SELECT COUNT(*) FROM tasks f WHERE f.forwarded_from_id = t.id)::int AS n_forwards
     FROM tasks t
     JOIN template_steps ts ON ts.id = t.template_step_id
     WHERE t.project_id = $1
       AND ts.code = ANY($2)
       AND t.status = ANY($3)
       AND t.result_data IS NULL
     ORDER BY ts.code, t.created_at`,
    [project.id, STEP_CODES, STATUSES],
  )

  if (victims.length === 0) {
    console.log('✅ Không có task nào khớp điều kiện — không có gì để dọn (idempotent).')
    await pool.end(); return
  }

  const deletable = victims.filter((v) => v.n_children === 0 && v.n_forwards === 0)
  const skipped = victims.filter((v) => v.n_children > 0 || v.n_forwards > 0)

  console.log(`Tìm thấy ${victims.length} task khớp điều kiện (step ∈ [${STEP_CODES.join(', ')}], status ∈ [${STATUSES.join(', ')}], chưa có resultData):\n`)
  for (const v of deletable) {
    console.log(`  🗑  [${v.step_code}] ${v.title} — status=${v.status}, id=${v.id}, tạo ${v.created_at.toISOString().slice(0, 10)}`)
  }
  for (const v of skipped) {
    console.warn(`  ⚠️  BỎ QUA [${v.step_code}] ${v.title} (id=${v.id}) — có ${v.n_children} task con / ${v.n_forwards} task forward trỏ tới, không xóa để giữ cây`)
  }
  console.log()

  if (deletable.length === 0) {
    console.log('Không còn task nào an toàn để xóa.')
    await pool.end(); return
  }

  if (!APPLY) {
    console.log(`[DRY-RUN] Sẽ xóa ${deletable.length} task (kèm assignee/history/doc con). Chạy với --apply để xóa thật.`)
    await pool.end(); return
  }

  const ids = deletable.map((v) => v.id)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Xóa con trước — không phụ thuộc cascade của DB
    const acks = await client.query(
      `DELETE FROM task_doc_acks WHERE requirement_id IN
         (SELECT id FROM task_doc_requirements WHERE task_id = ANY($1))`, [ids])
    const docs = await client.query(`DELETE FROM task_doc_requirements WHERE task_id = ANY($1)`, [ids])
    const assignees = await client.query(`DELETE FROM task_assignees WHERE task_id = ANY($1)`, [ids])
    const history = await client.query(`DELETE FROM task_history WHERE task_id = ANY($1)`, [ids])
    const tasks = await client.query(`DELETE FROM tasks WHERE id = ANY($1)`, [ids])
    await client.query('COMMIT')
    console.log(`[APPLIED] Đã xóa: ${tasks.rowCount} task, ${assignees.rowCount} assignee, ${history.rowCount} history, ${docs.rowCount} doc requirement, ${acks.rowCount} doc ack.`)
    console.log('Chạy lại không --apply để xác nhận 0 task khớp (idempotent).')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }

  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
