/**
 * Xóa dự án test + task test trên production.
 *
 * Dự án cần xóa (theo projectCode):
 *   DA-001-002, DA-001-003, ZZ-FLOW-TEST-001, 26-PLT-I-001
 *
 * Task rời cần xóa (không thuộc dự án, theo title):
 *   "Phòng TK Test.", "Phòng TK Test-2", "Phòng TK Test-3",
 *   "[Chuyển tiếp] Phòng TK Test-2"
 *
 * Thứ tự xóa:
 *   1. Task con (assignees, history, docs, acks) — của cả task rời + task thuộc project
 *   2. Tasks
 *   3. Project children (meetings, notifications, boms, budgets, POs, PRs, etc.)
 *   4. Projects
 *
 * Usage:
 *   npx tsx scripts/cleanup-test-projects.ts            # dry-run
 *   npx tsx scripts/cleanup-test-projects.ts --apply    # xóa thật
 */
import pg from 'pg'

if (!process.env.DATABASE_URL) { console.error('❌ DATABASE_URL not set'); process.exit(1) }
const connectionString: string = process.env.DATABASE_URL
const APPLY = process.argv.includes('--apply')

// Scope AN TOÀN: chỉ mã test theo pattern (ZZ-*, DA-001-*) — KHÔNG đụng dự án thật.
// (KHÔNG hardcode mã kiểu 26-PLT-I-001 vì không khớp pattern test.)
const PROJECT_CODE_PATTERNS = ['ZZ-%', 'DA-001-%']

const STANDALONE_TASK_TITLES = [
  'Phòng TK Test.',
  'Phòng TK Test-2',
  'Phòng TK Test-3',
  '[Chuyển tiếp] Phòng TK Test-2',
]

async function main() {
  const pool = new pg.Pool({
    connectionString,
    ssl: connectionString.includes('103.141') ? { rejectUnauthorized: false } : undefined,
  })
  console.log(`=== Cleanup test data — ${APPLY ? 'APPLY' : 'DRY-RUN'} ===`)
  console.log('DB:', connectionString.replace(/:[^:@/]+@/, ':***@'))
  console.log()

  // ── 1. Find projects (scope theo pattern test — an toàn) ──
  const { rows: projects } = await pool.query(
    `SELECT id, project_code, project_name FROM projects WHERE project_code LIKE ANY($1)`,
    [PROJECT_CODE_PATTERNS],
  )
  console.log(`Dự án test khớp [${PROJECT_CODE_PATTERNS.join(', ')}]: ${projects.length}`)
  for (const p of projects) {
    console.log(`  📁 ${p.project_code} — ${p.project_name} (id=${p.id})`)
  }
  console.log()

  const projectIds = projects.map((p: { id: string }) => p.id)

  // ── 2. Find project tasks ──
  const { rows: projectTasks } = projectIds.length > 0
    ? await pool.query(
        `SELECT id, title, status FROM tasks WHERE project_id = ANY($1) ORDER BY created_at`,
        [projectIds],
      )
    : { rows: [] }
  console.log(`Task thuộc dự án: ${projectTasks.length}`)
  for (const t of projectTasks.slice(0, 20)) {
    console.log(`  📋 [${t.status}] ${t.title} (id=${t.id})`)
  }
  if (projectTasks.length > 20) console.log(`  ... và ${projectTasks.length - 20} task khác`)
  console.log()

  // ── 3. Find standalone tasks ──
  const { rows: standaloneTasks } = await pool.query(
    `SELECT id, title, status FROM tasks WHERE title = ANY($1) ORDER BY created_at`,
    [STANDALONE_TASK_TITLES],
  )
  console.log(`Task rời (theo title): ${standaloneTasks.length}`)
  for (const t of standaloneTasks) {
    console.log(`  📋 [${t.status}] ${t.title} (id=${t.id})`)
  }
  console.log()

  const allTaskIds = [...projectTasks, ...standaloneTasks].map((t: { id: string }) => t.id)

  // ── 4. Count related data ──
  if (projectIds.length > 0) {
    const counts = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS c FROM meetings WHERE project_id = ANY($1)`, [projectIds]),
      pool.query(`SELECT COUNT(*)::int AS c FROM bill_of_materials WHERE project_id = ANY($1)`, [projectIds]),
      pool.query(`SELECT COUNT(*)::int AS c FROM budgets WHERE project_id = ANY($1)`, [projectIds]),
      pool.query(`SELECT COUNT(*)::int AS c FROM purchase_requests WHERE project_id = ANY($1)`, [projectIds]),
      pool.query(`SELECT COUNT(*)::int AS c FROM purchase_orders WHERE project_id = ANY($1)`, [projectIds]),
      pool.query(`SELECT COUNT(*)::int AS c FROM work_orders WHERE project_id = ANY($1)`, [projectIds]),
      pool.query(`SELECT COUNT(*)::int AS c FROM cashflow_entries WHERE project_id = ANY($1)`, [projectIds]),
      pool.query(`SELECT COUNT(*)::int AS c FROM milestones WHERE project_id = ANY($1)`, [projectIds]),
      pool.query(`SELECT COUNT(*)::int AS c FROM wbs_nodes WHERE project_id = ANY($1)`, [projectIds]),
      pool.query(`SELECT COUNT(*)::int AS c FROM change_events WHERE project_id = ANY($1)`, [projectIds]),
    ])
    const labels = ['meetings', 'boms', 'budgets', 'PRs', 'POs', 'work_orders', 'cashflow', 'milestones', 'wbs_nodes', 'change_events']
    console.log('Dữ liệu con của dự án:')
    labels.forEach((l, i) => {
      const c = counts[i].rows[0].c
      if (c > 0) console.log(`  ${l}: ${c}`)
    })
    console.log()
  }

  if (allTaskIds.length === 0 && projectIds.length === 0) {
    console.log('✅ Không tìm thấy dữ liệu test nào — không cần dọn.')
    await pool.end(); return
  }

  if (!APPLY) {
    console.log(`[DRY-RUN] Sẽ xóa: ${allTaskIds.length} tasks + ${projectIds.length} projects (kèm tất cả data con).`)
    console.log('Chạy với --apply để xóa thật.')
    await pool.end(); return
  }

  // ── 5. Delete ──
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 5a. Unlink forwarded_from_id to avoid FK constraint
    if (allTaskIds.length > 0) {
      await client.query(
        `UPDATE tasks SET forwarded_from_id = NULL WHERE forwarded_from_id = ANY($1)`, [allTaskIds])
      await client.query(
        `UPDATE tasks SET parent_id = NULL WHERE parent_id = ANY($1)`, [allTaskIds])
    }

    // 5b. Delete task children
    if (allTaskIds.length > 0) {
      const acks = await client.query(
        `DELETE FROM task_doc_acks WHERE requirement_id IN
           (SELECT id FROM task_doc_requirements WHERE task_id = ANY($1))`, [allTaskIds])
      const docs = await client.query(`DELETE FROM task_doc_requirements WHERE task_id = ANY($1)`, [allTaskIds])
      const assignees = await client.query(`DELETE FROM task_assignees WHERE task_id = ANY($1)`, [allTaskIds])
      const history = await client.query(`DELETE FROM task_history WHERE task_id = ANY($1)`, [allTaskIds])
      console.log(`  Xóa task children: ${assignees.rowCount} assignees, ${history.rowCount} history, ${docs.rowCount} docs, ${acks.rowCount} acks`)
    }

    // notifications table has no task_id/project_id — skip

    // 5d. Delete tasks
    if (allTaskIds.length > 0) {
      const tasks = await client.query(`DELETE FROM tasks WHERE id = ANY($1)`, [allTaskIds])
      console.log(`  Xóa ${tasks.rowCount} tasks`)
    }

    // 5e. Delete project children (tables without ON DELETE CASCADE)
    if (projectIds.length > 0) {
      // Meetings + invites
      const meetingIds = await client.query(
        `SELECT id FROM meetings WHERE project_id = ANY($1)`, [projectIds])
      const mIds = meetingIds.rows.map((r: { id: string }) => r.id)
      if (mIds.length > 0) {
        await client.query(`DELETE FROM meeting_invites WHERE meeting_id = ANY($1)`, [mIds])
        await client.query(`DELETE FROM meetings WHERE id = ANY($1)`, [mIds])
        console.log(`  Xóa ${mIds.length} meetings`)
      }

      // BOM versions + items (cascade from bom)
      const bomIds = await client.query(
        `SELECT id FROM bill_of_materials WHERE project_id = ANY($1)`, [projectIds])
      const bIds = bomIds.rows.map((r: { id: string }) => r.id)
      if (bIds.length > 0) {
        const versionIds = await client.query(
          `SELECT id FROM bom_versions WHERE bom_id = ANY($1)`, [bIds])
        const vIds = versionIds.rows.map((r: { id: string }) => r.id)
        if (vIds.length > 0) {
          await client.query(`DELETE FROM bom_items WHERE bom_version_id = ANY($1)`, [vIds])
          await client.query(`DELETE FROM bom_versions WHERE id = ANY($1)`, [vIds])
        }
        await client.query(`DELETE FROM bill_of_materials WHERE id = ANY($1)`, [bIds])
        console.log(`  Xóa ${bIds.length} BOMs`)
      }

      // PO items + POs
      const poIds = await client.query(
        `SELECT id FROM purchase_orders WHERE project_id = ANY($1)`, [projectIds])
      const pIds = poIds.rows.map((r: { id: string }) => r.id)
      if (pIds.length > 0) {
        await client.query(`DELETE FROM purchase_order_items WHERE po_id = ANY($1)`, [pIds])
        await client.query(`DELETE FROM purchase_orders WHERE id = ANY($1)`, [pIds])
        console.log(`  Xóa ${pIds.length} POs`)
      }

      // PR items + PRs
      const prIds = await client.query(
        `SELECT id FROM purchase_requests WHERE project_id = ANY($1)`, [projectIds])
      const prIdList = prIds.rows.map((r: { id: string }) => r.id)
      if (prIdList.length > 0) {
        await client.query(`DELETE FROM purchase_request_items WHERE pr_id = ANY($1)`, [prIdList])
        await client.query(`DELETE FROM purchase_requests WHERE id = ANY($1)`, [prIdList])
        console.log(`  Xóa ${prIdList.length} PRs`)
      }

      // Work orders + job cards
      const woIds = await client.query(
        `SELECT id FROM work_orders WHERE project_id = ANY($1)`, [projectIds])
      const wIds = woIds.rows.map((r: { id: string }) => r.id)
      if (wIds.length > 0) {
        await client.query(`DELETE FROM job_cards WHERE work_order_id = ANY($1)`, [wIds])
        await client.query(`DELETE FROM work_orders WHERE id = ANY($1)`, [wIds])
        console.log(`  Xóa ${wIds.length} work orders`)
      }

      // Delete from all project-linked tables using SAVEPOINT for each
      const projectTables = [
        'budgets', 'cashflow_entries', 'milestones', 'wbs_nodes',
        'change_events', 'delivery_records', 'invoices',
        'itp_checkpoints', 'inspection_items', 'inspection_test_plans', 'inspections',
        'non_conformance_reports', 'lesson_learned', 'timesheets',
        'piece_rate_contracts', 'monthly_piece_rate_outputs',
        'safety_incidents', 'hse_man_hours', 'work_permits',
        'engineering_change_orders', 'subcontractor_contracts',
        'drawing_revisions', 'drawings',
        'packing_list_items', 'packing_lists',
        'shipment_items', 'shipments',
        'project_baselines', 'project_submissions', 'project_settlements',
        'project_finance_plans', 'project_budget_lines', 'project_cashflow_monthly',
        'mrb_releases',
      ]
      for (const table of projectTables) {
        await client.query(`SAVEPOINT sp_${table}`)
        try {
          const r = await client.query(`DELETE FROM ${table} WHERE project_id = ANY($1)`, [projectIds])
          if (r.rowCount && r.rowCount > 0) console.log(`  Xóa ${r.rowCount} ${table}`)
          await client.query(`RELEASE SAVEPOINT sp_${table}`)
        } catch {
          await client.query(`ROLLBACK TO SAVEPOINT sp_${table}`)
        }
      }

      // Finally delete projects
      const proj = await client.query(`DELETE FROM projects WHERE id = ANY($1)`, [projectIds])
      console.log(`  Xóa ${proj.rowCount} projects`)
    }

    await client.query('COMMIT')
    console.log('\n✅ Hoàn tất xóa dữ liệu test.')
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('❌ Lỗi — đã ROLLBACK:', e)
    throw e
  } finally {
    client.release()
  }

  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
