/**
 * Sửa giờ 1 cuộc họp: set startsAt/endsAt theo giờ VN chính xác.
 *
 * Dry-run:  npx tsx scripts/fix-meeting-time.ts --meeting=<id> --vn="YYYY-MM-DD HH:mm" [--end="YYYY-MM-DD HH:mm"]
 * Apply:    npx tsx scripts/fix-meeting-time.ts --meeting=<id> --vn="YYYY-MM-DD HH:mm" [--end="YYYY-MM-DD HH:mm"] --apply
 *
 * Giờ VN truyền vào sẽ được convert sang UTC (trừ 7h) rồi ghi vào DB.
 */
import pg from 'pg'

function requireEnv(key: string): string {
  const v = process.env[key]
  if (!v) { console.error(`${key} is required`); process.exit(1) }
  return v
}

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`
  const arg = process.argv.find(a => a.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : undefined
}

function vnToUtc(vnStr: string): Date {
  const iso = vnStr.replace(' ', 'T') + ':00+07:00'
  const d = new Date(iso)
  if (isNaN(d.getTime())) { console.error(`Invalid datetime: "${vnStr}"`); process.exit(1) }
  return d
}

const connStr = requireEnv('DATABASE_URL')
const meetingId = getArg('meeting')
const vnStart = getArg('vn')
const vnEnd = getArg('end')
const isApply = process.argv.includes('--apply')

if (!meetingId || !vnStart) {
  console.error('Usage: npx tsx scripts/fix-meeting-time.ts --meeting=<id> --vn="YYYY-MM-DD HH:mm" [--end="YYYY-MM-DD HH:mm"] [--apply]')
  process.exit(1)
}

async function main() {
  pg.types.setTypeParser(1114, (str: string) => str)
  const pool = new pg.Pool({
    connectionString: connStr,
    ssl: connStr.includes('103.141') ? { rejectUnauthorized: false } : undefined,
  })

  const { rows } = await pool.query(
    `SELECT id, title, starts_at, ends_at, status FROM meetings WHERE id = $1`,
    [meetingId]
  )
  if (rows.length === 0) { console.error(`Meeting ${meetingId} not found`); await pool.end(); process.exit(1) }

  const m = rows[0]
  const newStartUtc = vnToUtc(vnStart!)
  const newEndUtc = vnEnd ? vnToUtc(vnEnd) : null

  const fmtUtc = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  const fmtVn = (d: Date) => new Date(d.getTime() + 7 * 3600000).toISOString().replace('T', ' ').slice(0, 16) + ' VN'

  console.log(`\n📅 ${m.title} [${m.status}]`)
  console.log(`   ID: ${m.id}`)
  console.log(`\n   HIỆN TẠI (raw DB):`)
  console.log(`     starts_at: ${m.starts_at}`)
  console.log(`     ends_at:   ${m.ends_at || '—'}`)
  console.log(`\n   SỬA THÀNH:`)
  console.log(`     starts_at: ${fmtUtc(newStartUtc)}  (hiển thị: ${fmtVn(newStartUtc)})`)
  if (newEndUtc) {
    console.log(`     ends_at:   ${fmtUtc(newEndUtc)}  (hiển thị: ${fmtVn(newEndUtc)})`)
  } else if (m.ends_at) {
    console.log(`     ends_at:   giữ nguyên`)
  }

  if (!isApply) {
    console.log(`\n🔍 DRY-RUN — thêm --apply để ghi.`)
    await pool.end()
    return
  }

  if (newEndUtc) {
    await pool.query(
      `UPDATE meetings SET starts_at = $1, ends_at = $2 WHERE id = $3`,
      [newStartUtc, newEndUtc, meetingId]
    )
  } else {
    await pool.query(
      `UPDATE meetings SET starts_at = $1 WHERE id = $2`,
      [newStartUtc, meetingId]
    )
  }
  console.log(`\n✅ Đã cập nhật.`)
  await pool.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
