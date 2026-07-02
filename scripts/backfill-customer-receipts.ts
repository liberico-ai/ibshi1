/**
 * Backfill Đợt 1C: mỗi Payment gắn hóa đơn RECEIVABLE → 1 CustomerReceipt.
 *
 * - referenceNo = 'PAY-<paymentId>' — idempotent theo referenceNo (chạy lại không nhân đôi)
 * - Sau khi tạo: recompute Invoice.paidAmount = Σ receipts (không +=), in diff cũ → mới
 * - KHÔNG đụng CashflowEntry cũ (đã sinh từ payment với entryCode CF-PAY-*)
 *
 * Dry-run (mặc định):   npx tsx scripts/backfill-customer-receipts.ts
 * Apply production:      npx tsx scripts/backfill-customer-receipts.ts --apply --i-understand-production
 */
import pg from 'pg'
import { randomUUID } from 'crypto'

function requireEnv(key: string): string {
  const v = process.env[key]
  if (!v) { console.error(`${key} is required`); process.exit(1) }
  return v
}
const connStr = requireEnv('DATABASE_URL')
const isApply = process.argv.includes('--apply') && process.argv.includes('--i-understand-production')

// Map method Payment → CustomerReceipt (BANK | CASH | OTHER)
function mapMethod(paymentMethod: string | null): string {
  if (paymentMethod === 'CASH') return 'CASH'
  if (paymentMethod === 'BANK_TRANSFER') return 'BANK'
  return 'OTHER'
}

async function main() {
  const pool = new pg.Pool({ connectionString: connStr, ssl: connStr.includes('103.141') ? { rejectUnauthorized: false } : undefined })

  // Bảng customer_receipts phải tồn tại (migration 20260702150000_customer_receipt)
  const { rows: tableCheck } = await pool.query(`
    SELECT 1 FROM information_schema.tables WHERE table_name = 'customer_receipts'
  `)
  if (tableCheck.length === 0) {
    console.log('=== Backfill CustomerReceipt ===')
    console.log('  Bảng "customer_receipts" chưa tồn tại — chạy migration trước: prisma migrate deploy')
    await pool.end()
    return
  }

  // Payment gắn hóa đơn RECEIVABLE
  const { rows: payments } = await pool.query(`
    SELECT p.id, p.invoice_id, p.amount, p.payment_date, p.method, p.reference, p.notes,
           i.invoice_code, i.project_id, i.total_amount, i.paid_amount, i.status
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id
    WHERE i.type = 'RECEIVABLE'
    ORDER BY p.payment_date ASC
  `)

  // Receipt backfill đã tồn tại (idempotent theo reference_no = 'PAY-<paymentId>')
  const { rows: existing } = await pool.query(`
    SELECT reference_no FROM customer_receipts WHERE reference_no LIKE 'PAY-%'
  `)
  const existingRefs = new Set(existing.map(r => r.reference_no as string))

  const toCreate = payments.filter(p => !existingRefs.has(`PAY-${p.id}`))
  const skipped = payments.length - toCreate.length

  console.log('=== Backfill CustomerReceipt (Payment RECEIVABLE → phiếu thu) ===')
  console.log(`  Payment gắn hóa đơn RECEIVABLE:  ${payments.length}`)
  console.log(`  Đã có receipt (PAY-*):            ${skipped}`)
  console.log(`  Sẽ tạo receipt mới:               ${toCreate.length}`)
  console.log()

  for (const p of toCreate) {
    console.log(`  + PAY-${p.id}  invoice=${p.invoice_code}  amount=${Number(p.amount)}  method=${mapMethod(p.method)}  date=${new Date(p.payment_date).toISOString().slice(0, 10)}`)
  }
  if (toCreate.length > 0) console.log()

  if (!isApply) {
    // Dry-run: tính diff paidAmount dự kiến (Σ receipts hiện có + receipts sẽ tạo)
    const invoiceIds = [...new Set(payments.map(p => p.invoice_id as string))]
    if (invoiceIds.length > 0) {
      const { rows: sums } = await pool.query(`
        SELECT invoice_id, COALESCE(SUM(amount), 0) AS total
        FROM customer_receipts WHERE invoice_id = ANY($1::text[])
        GROUP BY invoice_id
      `, [invoiceIds])
      const receiptSum = new Map(sums.map(r => [r.invoice_id as string, Number(r.total)]))
      console.log('  Diff paidAmount dự kiến (cũ → mới = Σ receipts sau backfill):')
      for (const invId of invoiceIds) {
        const inv = payments.find(p => p.invoice_id === invId)!
        const newReceipts = toCreate.filter(p => p.invoice_id === invId).reduce((s, p) => s + Number(p.amount), 0)
        const expected = (receiptSum.get(invId) || 0) + newReceipts
        const old = Number(inv.paid_amount)
        console.log(`    ${inv.invoice_code}: ${old} → ${expected}${old !== expected ? '  (THAY ĐỔI)' : ''}`)
      }
    }
    console.log()
    console.log('  [DRY-RUN] Không có thay đổi. Chạy với --apply --i-understand-production để áp dụng.')
    await pool.end()
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    for (const p of toCreate) {
      await client.query(`
        INSERT INTO customer_receipts
          (id, invoice_id, project_id, amount, method, received_at, reference_no, notes, created_by, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [
        randomUUID(), p.invoice_id, p.project_id, p.amount, mapMethod(p.method),
        p.payment_date, `PAY-${p.id}`,
        p.notes ? `Backfill từ payment ${p.id}: ${p.notes}` : `Backfill từ payment ${p.id}`,
        'backfill-script',
      ])
    }

    // Recompute paidAmount từ receipts cho các invoice RECEIVABLE bị ảnh hưởng + in diff
    const invoiceIds = [...new Set(payments.map(p => p.invoice_id as string))]
    console.log('  Recompute paidAmount (cũ → mới):')
    for (const invId of invoiceIds) {
      const { rows: [sum] } = await client.query(`
        SELECT COALESCE(SUM(amount), 0) AS total FROM customer_receipts WHERE invoice_id = $1
      `, [invId])
      const { rows: [inv] } = await client.query(`
        SELECT invoice_code, total_amount, paid_amount, status FROM invoices WHERE id = $1
      `, [invId])
      const newPaid = Number(sum.total)
      const total = Number(inv.total_amount)
      const newStatus = newPaid >= total && total > 0 ? 'PAID'
        : newPaid > 0 ? 'PARTIAL'
        : (['PAID', 'PARTIAL'].includes(inv.status) ? 'SENT' : inv.status)
      await client.query(`UPDATE invoices SET paid_amount = $1, status = $2 WHERE id = $3`, [newPaid, newStatus, invId])
      console.log(`    ${inv.invoice_code}: paidAmount ${Number(inv.paid_amount)} → ${newPaid}, status ${inv.status} → ${newStatus}`)
    }

    await client.query('COMMIT')
    console.log()
    console.log(`  [APPLIED] Đã tạo ${toCreate.length} receipt, recompute ${invoiceIds.length} hóa đơn.`)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
