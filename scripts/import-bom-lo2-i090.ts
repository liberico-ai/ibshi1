/**
 * LÔ 2 phụ — I-090 (26-BRA-I-090). Parse CHỈ sheet 'REV42' (bỏ 'DATA' = cutting-list).
 * parsePrExcel THẬT. Verify Σ netWeight ≈ DTTC 2,793,352 kg (gate ≤20%).
 * Tạo container task P2.1 (DONE) + bomPrItems + enrich MATCH-ONLY. Idempotent.
 *
 * Chạy: npx tsx scripts/import-bom-lo2-i090.ts          # dry-run
 *       npx tsx scripts/import-bom-lo2-i090.ts --apply   # ghi DB
 */
import * as path from 'path'
import * as fs from 'fs'
import * as XLSX from 'xlsx'
import { parsePrExcel } from './bompr-parse'
import { prisma } from '@/lib/db'
import { enrichBomPrItems } from '@/lib/bompr-enrich'

const APPLY = process.argv.includes('--apply')
const PROJECT_CODE = '26-BRA-I-090'
const FILE = path.join(process.cwd(), 'docs/handoff/import/bom/I-090-ENG-001-REV42(PR).xlsx')
const SHEET = 'REV42'
const DTTC_TARGET = 1_382_393 // kg (design 090 = subtotal A+B+C của REV42; số 2.79M trước là của 095, chép nhầm)
const MARKER = '(nhập từ Drive)'
const TITLE = `BOM/VT chính ${MARKER}`
const IMPORTER = 'toannd'

async function main() {
  console.log(`=== Import BOM I-090 (${PROJECT_CODE}) — ${APPLY ? 'APPLY' : 'DRY-RUN'} ===\n`)

  const importer = await prisma.user.findUnique({ where: { username: IMPORTER }, select: { id: true } })
  if (!importer) { console.error(`❌ Không tìm thấy user ${IMPORTER}`); process.exit(1) }
  const project = await prisma.project.findUnique({ where: { projectCode: PROJECT_CODE }, select: { id: true } })
  if (!project) { console.error(`❌ Không tìm thấy dự án ${PROJECT_CODE}`); process.exit(1) }

  // Chống đè: nếu 090 đã có BẤT KỲ task nào chứa bomPrItems (data thật) → dừng
  const anyData = await prisma.task.findFirst({
    where: { projectId: project.id, NOT: { resultData: { equals: undefined } } },
    select: { id: true, resultData: true, title: true },
  })
  // kiểm cụ thể: task nào có key bomPrItems
  const existingData = await prisma.task.findMany({
    where: { projectId: project.id },
    select: { id: true, title: true, taskType: true, resultData: true },
  })
  const withBompr = existingData.filter(t => t.resultData && typeof t.resultData === 'object' && 'bomPrItems' in (t.resultData as object))
  const container = withBompr.find(t => t.taskType === 'P2.1' && t.title.includes(MARKER))
  const otherData = withBompr.filter(t => t.id !== container?.id)
  void anyData
  if (otherData.length > 0) {
    console.log(`🛑 090 ĐÃ CÓ task chứa bomPrItems (data thật) — GIỮ NGUYÊN, không đè:`)
    for (const t of otherData) console.log(`   - ${t.id} [${t.taskType}] "${t.title}"`)
    await prisma.$disconnect()
    return
  }

  // Parse CHỈ sheet REV42
  const wb = XLSX.read(fs.readFileSync(FILE), { type: 'buffer' })
  if (!wb.SheetNames.includes(SHEET)) { console.error(`❌ File không có sheet '${SHEET}' (có: ${wb.SheetNames.join(', ')})`); process.exit(1) }
  const data = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[SHEET], { header: 1 })
  const items = parsePrExcel(data)

  const sumNet = items.reduce((s, i) => s + (Number(i.netWeight) || 0), 0)
  const diffPct = Math.abs(sumNet - DTTC_TARGET) / DTTC_TARGET * 100
  console.log(`Parse sheet '${SHEET}': ${items.length} item`)
  console.log(`Σ netWeight: ${Math.round(sumNet).toLocaleString()} kg | DTTC: ${DTTC_TARGET.toLocaleString()} kg | lệch ${diffPct.toFixed(1)}%  ${diffPct <= 20 ? '✅ KHỚP' : '❌ LỆCH >20%'}`)

  if (diffPct > 20) {
    console.log('\n❌ LỆCH >20% — DỪNG, không ghi DB (nghi parse/sheet sai).')
    await prisma.$disconnect()
    return
  }

  // enrich MATCH-ONLY
  const enriched = await enrichBomPrItems(items as never, PROJECT_CODE, { matchOnly: true })
  const matched = enriched.filter((i: Record<string, unknown>) => !!i.materialId).length
  console.log(`enrich match-only: ${matched} khớp kho / ${enriched.length - matched} materialId=null`)
  console.log(`container task: ${container ? `tái dùng ${container.id}` : 'SẼ TẠO MỚI (P2.1, DONE)'}`)

  if (APPLY) {
    const bomPrItems = JSON.stringify(enriched)
    if (container) {
      const rd = (container.resultData && typeof container.resultData === 'object') ? container.resultData as Record<string, unknown> : {}
      await prisma.task.update({ where: { id: container.id }, data: { resultData: { ...rd, bomPrItems } } })
      console.log(`   ✓ đã ghi đè bomPrItems vào task ${container.id}`)
    } else {
      const created = await prisma.task.create({
        data: {
          title: TITLE, projectId: project.id, taskType: 'P2.1', status: 'DONE',
          description: `Container dữ liệu BOM/VT chính nhập từ Drive (I-090 REV42). ${items.length} item.`,
          createdBy: importer.id,
          resultData: { bomPrItems },
        },
        select: { id: true },
      })
      console.log(`   ✓ đã tạo task ${created.id}`)
    }
  }

  console.log(`\n${APPLY ? '✅ ĐÃ GHI DB' : '🔍 DRY-RUN — chưa ghi. Chạy với --apply để nạp.'}`)
  await prisma.$disconnect()
}

main().catch(err => { console.error('❌ Lỗi:', err); process.exit(1) })
