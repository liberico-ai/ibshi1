/**
 * Backfill: đọc Task có resultData.briefing.blocked==='true' → set cột blocked=true.
 *
 * Dry-run (mặc định):   npx tsx scripts/backfill-task-blocked.ts
 * Apply production:      npx tsx scripts/backfill-task-blocked.ts --apply --i-understand-production
 */
import pg from 'pg'

function requireEnv(key: string): string {
  const v = process.env[key]
  if (!v) { console.error(`${key} is required`); process.exit(1) }
  return v
}
const connStr = requireEnv('DATABASE_URL')
const isApply = process.argv.includes('--apply') && process.argv.includes('--i-understand-production')

async function main() {
  const pool = new pg.Pool({ connectionString: connStr, ssl: connStr.includes('103.141') ? { rejectUnauthorized: false } : undefined })

  // Check if blocked column exists
  const { rows: colCheck } = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'blocked'
  `)
  if (colCheck.length === 0) {
    console.log('=== Backfill Task.blocked ===')
    console.log('  Cột "blocked" chưa tồn tại trên DB.')
    console.log('  Chạy migration trước: prisma migrate deploy')

    // Still show how many rows WOULD need backfilling
    const { rows: preview } = await pool.query(`
      SELECT COUNT(*) AS cnt FROM tasks
      WHERE result_data->'briefing'->>'blocked' = 'true'
    `)
    console.log(`  Số task sẽ cần backfill sau migration: ${preview[0].cnt}`)
    await pool.end()
    return
  }

  // Count candidates
  const { rows: candidates } = await pool.query(`
    SELECT id, status, blocked, result_data->'briefing'->>'blocked' AS briefing_blocked
    FROM tasks
    WHERE result_data->'briefing'->>'blocked' = 'true'
  `)

  const needUpdate = candidates.filter(r => !r.blocked)
  const alreadyCorrect = candidates.filter(r => r.blocked)

  console.log(`=== Backfill Task.blocked ===`)
  console.log(`  Tổng task có briefing.blocked='true': ${candidates.length}`)
  console.log(`  Đã đúng cột blocked=true:            ${alreadyCorrect.length}`)
  console.log(`  Cần cập nhật cột blocked:             ${needUpdate.length}`)
  console.log()

  if (needUpdate.length > 0) {
    console.log('  Danh sách cần cập nhật:')
    for (const r of needUpdate) {
      console.log(`    ${r.id}  status=${r.status}  blocked=${r.blocked}`)
    }
    console.log()
  }

  if (!isApply) {
    console.log('  [DRY-RUN] Không có thay đổi. Chạy với --apply --i-understand-production để áp dụng.')
    await pool.end()
    return
  }

  if (needUpdate.length === 0) {
    console.log('  Không có gì cần cập nhật.')
    await pool.end()
    return
  }

  const ids = needUpdate.map(r => r.id)
  const result = await pool.query(`UPDATE tasks SET blocked = true WHERE id = ANY($1::text[])`, [ids])
  console.log(`  [APPLIED] Đã cập nhật ${result.rowCount} dòng.`)

  // Verify
  const { rows: verify } = await pool.query(`
    SELECT COUNT(*) AS cnt FROM tasks
    WHERE result_data->'briefing'->>'blocked' = 'true' AND blocked = false
  `)
  console.log(`  Kiểm tra sau: còn ${verify[0].cnt} dòng chưa đồng bộ.`)

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
