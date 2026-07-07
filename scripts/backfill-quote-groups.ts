/**
 * Backfill quote_groups tables from P3.6 task resultData JSON.
 *
 * Reads all P3.6 tasks, extracts groups from resultData, and syncs
 * them into the normalized quote_groups / quote_group_items /
 * supplier_quote_lines tables using the same upsert logic as the
 * dual-write path (idempotent — safe to re-run).
 *
 * Usage:
 *   npx tsx scripts/backfill-quote-groups.ts          # dry-run
 *   npx tsx scripts/backfill-quote-groups.ts --apply   # write to DB
 */
import pg from 'pg'
import * as crypto from 'crypto'
import 'dotenv/config'

const APPLY = process.argv.includes('--apply')

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set')
  process.exit(1)
}

function cuid(): string {
  const ts = Date.now().toString(36)
  const rnd = crypto.randomBytes(8).toString('hex')
  return `cl${ts}${rnd}`
}

async function main() {
  const connStr = process.env.DATABASE_URL!
  const client = new pg.Client({
    connectionString: connStr,
    ssl: connStr.includes('103.141') ? { rejectUnauthorized: false } : undefined,
  })
  await client.connect()

  console.log(`=== Backfill quote_groups — ${APPLY ? 'APPLY' : 'DRY-RUN'} ===`)

  // Find all P3.6 tasks with resultData
  const { rows: tasks } = await client.query(
    `SELECT id, project_id, result_data FROM tasks WHERE task_type = 'P3.6' AND result_data IS NOT NULL`,
  )
  console.log(`Found ${tasks.length} P3.6 tasks`)

  let totalGroups = 0
  let totalItems = 0
  let totalLines = 0

  for (const task of tasks) {
    const rd = typeof task.result_data === 'string' ? JSON.parse(task.result_data) : task.result_data
    const groups = rd?.groups
    if (!Array.isArray(groups) || groups.length === 0) continue

    console.log(`  Task ${task.id}: ${groups.length} groups`)

    for (const g of groups) {
      const groupKey = String(g.id || `GRP-${Date.now()}-${Math.random()}`)
      totalGroups++

      if (!APPLY) {
        const itemCount = (g.items || []).length
        totalItems += itemCount
        totalLines += itemCount * 3
        console.log(`    [${g.status}] ${g.name || 'unnamed'} — ${itemCount} items`)
        continue
      }

      // Upsert group
      const groupId = cuid()
      const { rows: upserted } = await client.query(
        `INSERT INTO quote_groups (id, task_id, project_id, group_key, name, status, total_value,
           pr_code, payment_status, delivery_date, payment_date, assigned_supplier, rejected_reason,
           created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
         ON CONFLICT (task_id, group_key)
         DO UPDATE SET
           name = EXCLUDED.name, status = EXCLUDED.status, total_value = EXCLUDED.total_value,
           pr_code = EXCLUDED.pr_code, payment_status = EXCLUDED.payment_status,
           delivery_date = EXCLUDED.delivery_date, payment_date = EXCLUDED.payment_date,
           assigned_supplier = EXCLUDED.assigned_supplier, rejected_reason = EXCLUDED.rejected_reason,
           updated_at = NOW()
         RETURNING id`,
        [
          groupId, task.id, task.project_id, groupKey,
          g.name || g.groupName || 'Nhóm vật tư',
          g.status || 'PENDING',
          g.totalValue || 0,
          g.prCode || null,
          g.paymentStatus || null,
          g.deliveryDate ? new Date(g.deliveryDate) : null,
          g.paymentDate ? new Date(g.paymentDate) : null,
          g.assignedSupplier || null,
          g.rejectedReason || null,
        ],
      )
      const resolvedGroupId = upserted[0].id

      // Delete existing items for this group (replace strategy)
      await client.query(
        `DELETE FROM supplier_quote_lines WHERE item_id IN (SELECT id FROM quote_group_items WHERE quote_group_id = $1)`,
        [resolvedGroupId],
      )
      await client.query(`DELETE FROM quote_group_items WHERE quote_group_id = $1`, [resolvedGroupId])

      // Insert items + quote lines
      for (const item of g.items || []) {
        const itemId = cuid()
        totalItems++

        await client.query(
          `INSERT INTO quote_group_items (id, quote_group_id, name, code, spec, unit, source,
             quantity, requested_qty, in_stock, shortfall, spec_match, matched_material,
             selected_quote_index, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())`,
          [
            itemId, resolvedGroupId,
            item.name || '', item.code || '', item.spec || null, item.unit || '',
            item.source || '', String(item.quantity ?? '0'),
            item.requestedQty || 0, item.inStock || 0, item.shortfall || 0,
            item.specMatch || false,
            item.matchedMaterial ? JSON.stringify(item.matchedMaterial) : null,
            item.selectedQuoteIndex || 0,
          ],
        )

        if (Array.isArray(item.quotes)) {
          for (let idx = 0; idx < item.quotes.length; idx++) {
            const q = item.quotes[idx]
            totalLines++
            await client.query(
              `INSERT INTO supplier_quote_lines (id, item_id, line_index, supplier_name, unit_price, created_at)
               VALUES ($1, $2, $3, $4, $5, NOW())`,
              [cuid(), itemId, idx, q.ncc || '', q.price || 0],
            )
          }
        }
      }
    }
  }

  console.log(`\nTotals: ${totalGroups} groups, ${totalItems} items, ${totalLines} quote lines`)
  if (!APPLY) {
    console.log('Pass --apply to write to DB.')
  } else {
    console.log('Backfill complete.')
  }

  await client.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
