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

function vnToUtc(vnStr: string): { date: Date; utcStr: string } {
  const iso = vnStr.replace(' ', 'T') + ':00+07:00'
  const d = new Date(iso)
  if (isNaN(d.getTime())) { console.error(`Invalid datetime: "${vnStr}"`); process.exit(1) }
  // UTC string for writing to "timestamp without time zone" — bypasses pg driver local-tz conversion
  const utcStr = d.toISOString().replace('T', ' ').slice(0, 19)
  return { date: d, utcStr }
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
  const start = vnToUtc(vnStart!)
  const end = vnEnd ? vnToUtc(vnEnd) : null

  const fmtVn = (d: Date) => new Date(d.getTime() + 7 * 3600000).toISOString().replace('T', ' ').slice(0, 16) + ' VN'

  console.log(`\n📅 ${m.title} [${m.status}]`)
  console.log(`   ID: ${m.id}`)
  console.log(`\n   HIỆN TẠI (raw DB):`)
  console.log(`     starts_at: ${m.starts_at}`)
  console.log(`     ends_at:   ${m.ends_at || '—'}`)
  console.log(`\n   SỬA THÀNH (raw DB sẽ ghi):`)
  console.log(`     starts_at: ${start.utcStr}  (hiển thị: ${fmtVn(start.date)})`)
  if (end) {
    console.log(`     ends_at:   ${end.utcStr}  (hiển thị: ${fmtVn(end.date)})`)
  } else if (m.ends_at) {
    console.log(`     ends_at:   giữ nguyên`)
  }

  if (!isApply) {
    console.log(`\n🔍 DRY-RUN — thêm --apply để ghi.`)
    await pool.end()
    return
  }

  // Pass UTC strings directly — NOT Date objects — to avoid pg driver local-tz shift
  if (end) {
    await pool.query(
      `UPDATE meetings SET starts_at = $1::timestamp, ends_at = $2::timestamp WHERE id = $3`,
      [start.utcStr, end.utcStr, meetingId]
    )
  } else {
    await pool.query(
      `UPDATE meetings SET starts_at = $1::timestamp WHERE id = $2`,
      [start.utcStr, meetingId]
    )
  }
  console.log(`\n✅ Đã cập nhật.`)
  await pool.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
