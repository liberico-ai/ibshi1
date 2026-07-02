/**
 * Fix data template SX-PROD (đồ thị gãy: nhiều bước nextCodes=[] → chuỗi chết,
 * bước phase 4-5 bị coi là entry và spawn ngày 1).
 *
 * Đồng bộ TemplateStep của template code='SX-PROD' theo WORKFLOW_RULES
 * (src/lib/workflow-constants.ts): nextCodes ← rule.next, gateCodes ← rule.gate,
 * orderIndex ← thứ tự khai báo trong WORKFLOW_RULES, roleCode ← rule.role,
 * deadlineDays ← rule.deadlineDays.
 *
 * AN TOÀN:
 *  - UPDATE từng step theo (templateId, code) — TUYỆT ĐỐI KHÔNG delete/recreate
 *    (52+ task đang trỏ templateStepId).
 *  - Step có trong template mà không có trong WORKFLOW_RULES (hoặc ngược lại)
 *    → chỉ LOG cảnh báo, không xóa/thêm.
 *  - Idempotent: chạy lại lần 2 → 0 diff.
 *
 * Usage:
 *   npx tsx scripts/fix-sxprod-template.ts            # dry-run (mặc định, chỉ in diff)
 *   npx tsx scripts/fix-sxprod-template.ts --apply    # ghi thay đổi vào DB
 */
import pg from 'pg'
import { WORKFLOW_RULES } from '../src/lib/workflow-constants'

if (!process.env.DATABASE_URL) { console.error('❌ DATABASE_URL not set'); process.exit(1) }
const connectionString: string = process.env.DATABASE_URL
const APPLY = process.argv.includes('--apply')
const TEMPLATE_CODE = 'SX-PROD'

interface DbStep {
  id: string
  code: string
  title: string
  role_code: string | null
  order_index: number
  deadline_days: number | null
  next_codes: string[]
  gate_codes: string[]
}

// So sánh mảng string theo thứ tự (nextCodes/gateCodes có ý nghĩa thứ tự nhẹ, giữ ổn định)
const sameArr = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])
const fmtArr = (a: string[]) => (a.length ? `[${a.join(', ')}]` : '[]')

async function main() {
  const pool = new pg.Pool({
    connectionString,
    ssl: connectionString.includes('103.141') ? { rejectUnauthorized: false } : undefined,
  })
  console.log(`=== Fix template ${TEMPLATE_CODE} — ${APPLY ? 'APPLY' : 'DRY-RUN'} ===`)
  console.log('DB:', connectionString.replace(/:[^:@/]+@/, ':***@'))

  const { rows: tpls } = await pool.query(
    `SELECT id, code, name FROM workflow_templates WHERE code = $1`, [TEMPLATE_CODE])
  if (tpls.length === 0) {
    console.error(`❌ Không tìm thấy template code='${TEMPLATE_CODE}'`)
    await pool.end(); process.exit(1)
  }
  const tpl = tpls[0]
  console.log(`Template: ${tpl.code} — ${tpl.name} (id=${tpl.id})\n`)

  const { rows: dbSteps } = await pool.query<DbStep>(
    `SELECT id, code, title, role_code, order_index, deadline_days, next_codes, gate_codes
     FROM template_steps WHERE template_id = $1 ORDER BY order_index`, [tpl.id])

  const ruleCodes = Object.keys(WORKFLOW_RULES) // thứ tự khai báo = orderIndex chuẩn
  const dbByCode = new Map(dbSteps.map((s) => [s.code, s]))

  // Cảnh báo lệch tập step (chỉ log, không xóa/thêm)
  const onlyInDb = dbSteps.map((s) => s.code).filter((c) => !WORKFLOW_RULES[c])
  const onlyInRules = ruleCodes.filter((c) => !dbByCode.has(c))
  if (onlyInDb.length) console.warn(`⚠️  Step CÓ trong template, KHÔNG có trong WORKFLOW_RULES (giữ nguyên, không sửa): ${onlyInDb.join(', ')}`)
  if (onlyInRules.length) console.warn(`⚠️  Step CÓ trong WORKFLOW_RULES, KHÔNG có trong template (không tự thêm): ${onlyInRules.join(', ')}`)

  // Cảnh báo cạnh next trỏ tới code không tồn tại trong template (engine sẽ bỏ qua cạnh đó)
  for (const code of ruleCodes) {
    if (!dbByCode.has(code)) continue
    for (const nc of WORKFLOW_RULES[code].next || []) {
      if (!dbByCode.has(nc)) console.warn(`⚠️  ${code}.next trỏ tới '${nc}' không có trong template — engine sẽ bỏ qua cạnh này`)
    }
    for (const gc of WORKFLOW_RULES[code].gate || []) {
      if (!dbByCode.has(gc)) console.warn(`⚠️  ${code}.gate yêu cầu '${gc}' không có trong template — gate sẽ không bao giờ thỏa!`)
    }
  }
  console.log()

  let changed = 0
  let unchanged = 0
  for (const [idx, code] of ruleCodes.entries()) {
    const db = dbByCode.get(code)
    if (!db) continue // đã cảnh báo ở trên
    const rule = WORKFLOW_RULES[code]
    const desired = {
      next_codes: rule.next || [],
      gate_codes: rule.gate || [],
      order_index: idx,
      role_code: rule.role,
      deadline_days: rule.deadlineDays ?? null,
    }
    const diffs: string[] = []
    if (!sameArr(db.next_codes || [], desired.next_codes)) diffs.push(`  nextCodes:    ${fmtArr(db.next_codes || [])}  →  ${fmtArr(desired.next_codes)}`)
    if (!sameArr(db.gate_codes || [], desired.gate_codes)) diffs.push(`  gateCodes:    ${fmtArr(db.gate_codes || [])}  →  ${fmtArr(desired.gate_codes)}`)
    if (db.order_index !== desired.order_index) diffs.push(`  orderIndex:   ${db.order_index}  →  ${desired.order_index}`)
    if ((db.role_code || null) !== desired.role_code) diffs.push(`  roleCode:     ${db.role_code ?? 'null'}  →  ${desired.role_code}`)
    if ((db.deadline_days ?? null) !== desired.deadline_days) diffs.push(`  deadlineDays: ${db.deadline_days ?? 'null'}  →  ${desired.deadline_days ?? 'null'}`)

    if (diffs.length === 0) { unchanged++; continue }
    changed++
    console.log(`── ${code} (${db.title}) — ${diffs.length} thay đổi:`)
    for (const d of diffs) console.log(d)

    if (APPLY) {
      // UPDATE theo (templateId, code) — không đụng id/title/hookKeys/taskType
      await pool.query(
        `UPDATE template_steps
         SET next_codes = $1, gate_codes = $2, order_index = $3, role_code = $4, deadline_days = $5
         WHERE template_id = $6 AND code = $7`,
        [desired.next_codes, desired.gate_codes, desired.order_index, desired.role_code, desired.deadline_days, tpl.id, code],
      )
      console.log('  ✓ đã UPDATE')
    }
  }

  console.log(`\n=== Tổng kết: ${changed} step cần sửa, ${unchanged} step đã đúng, ${onlyInDb.length} step ngoài rules (giữ nguyên) ===`)
  if (!APPLY) console.log('[DRY-RUN] Không có thay đổi nào được ghi. Chạy với --apply để áp dụng.')
  else console.log('[APPLIED] Đã ghi thay đổi. Chạy lại không --apply để xác nhận 0 diff (idempotent).')

  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
