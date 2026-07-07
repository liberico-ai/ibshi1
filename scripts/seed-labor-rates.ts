/**
 * Seed labor rates (đơn giá nhân công theo công đoạn) from CSV.
 *
 * Source: docs/handoff/import/labor_rates_import.csv
 * Columns: stage, stageName, subItem, unitPriceRev2, unit
 *
 * Usage:
 *   npx tsx scripts/seed-labor-rates.ts              # dry-run (default)
 *   npx tsx scripts/seed-labor-rates.ts --apply       # write to DB
 */
import pg from 'pg'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import 'dotenv/config'

// ── args ──
const APPLY = process.argv.includes('--apply')

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set')
  process.exit(1)
}

const CSV_PATH = path.resolve(__dirname, '../docs/handoff/import/labor_rates_import.csv')
const REVISION = 'Rev2'

interface LaborRow {
  stage: string
  stageName: string
  subItem: string
  unitPrice: number
  unit: string
}

function readCsv(): LaborRow[] {
  const raw = fs.readFileSync(CSV_PATH, 'utf-8')
  const lines = raw.trim().split('\n')
  // skip header
  const rows: LaborRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    // format: stage,stageName,subItem,unitPriceRev2,unit
    // unit may contain commas inside (e.g. "VND/kg") but in this data it doesn't
    const parts = line.split(',')
    if (parts.length < 5) {
      console.warn(`[skip] line ${i + 1}: not enough columns`)
      continue
    }
    rows.push({
      stage: parts[0].trim(),
      stageName: parts[1].trim(),
      subItem: parts[2].trim(),
      unitPrice: Number(parts[3].trim()),
      unit: parts[4].trim(),
    })
  }
  return rows
}

function cuid(): string {
  // simple cuid-like id
  const ts = Date.now().toString(36)
  const rnd = crypto.randomBytes(8).toString('hex')
  return `cl${ts}${rnd}`
}

async function main() {
  const rows = readCsv()
  console.log(`[seed-labor-rates] Read ${rows.length} rows from CSV`)
  console.log(`[seed-labor-rates] Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`)

  if (!APPLY) {
    console.log('\nPreview (first 5 rows):')
    for (const r of rows.slice(0, 5)) {
      console.log(`  ${r.stage} | ${r.subItem} | ${r.unitPrice} ${r.unit}`)
    }
    console.log(`\n... total ${rows.length} rows. Pass --apply to write to DB.`)
    return
  }

  const connStr = process.env.DATABASE_URL!
  const client = new pg.Client({
    connectionString: connStr,
    ssl: connStr.includes('103.141') ? { rejectUnauthorized: false } : undefined,
  })
  await client.connect()

  let inserted = 0
  let updated = 0

  try {
    await client.query('BEGIN')

    for (const r of rows) {
      const id = cuid()

      const res = await client.query(
        `INSERT INTO labor_rates (id, stage, stage_name, sub_item, unit_price, unit, revision, effective_date, project_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NULL, NOW(), NOW())
         ON CONFLICT (stage, sub_item, revision)
         DO UPDATE SET
           stage_name = EXCLUDED.stage_name,
           unit_price = EXCLUDED.unit_price,
           unit = EXCLUDED.unit,
           updated_at = NOW()
         RETURNING (xmax = 0) AS is_insert`,
        [id, r.stage, r.stageName, r.subItem, r.unitPrice, r.unit, REVISION]
      )

      if (res.rows[0]?.is_insert) {
        inserted++
      } else {
        updated++
      }
    }

    await client.query('COMMIT')
    console.log(`\n[seed-labor-rates] Done: ${inserted} inserted, ${updated} updated (total ${rows.length})`)
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('[seed-labor-rates] Error, rolled back:', err)
    process.exit(1)
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
