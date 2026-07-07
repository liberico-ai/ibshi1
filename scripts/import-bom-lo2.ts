/**
 * LÔ 2 bước 2 — tạo container task P2.1 (DONE) + lưu bomPrItems cho 3 dự án (095/078/097).
 * Parse bằng parsePrExcel THẬT (scripts/bompr-parse). Enrich MATCH-ONLY (không tạo material tạm).
 * KHÔNG tạo BomItem/BomVersion. KHÔNG đụng 104/109/111/112.
 * Idempotent: container task theo marker title → tái dùng, ghi đè bomPrItems.
 *
 * Chạy: npx tsx scripts/import-bom-lo2.ts          # dry-run
 *       npx tsx scripts/import-bom-lo2.ts --apply   # ghi DB
 */
import * as path from 'path'
import { parseFile } from './bompr-parse'
import { prisma } from '@/lib/db'
import { enrichBomPrItems } from '@/lib/bompr-enrich'

const APPLY = process.argv.includes('--apply')
const BOM_DIR = path.join(process.cwd(), 'docs/handoff/import/bom')
const MARKER = '(nhập từ Drive)'
const TITLE = `BOM/VT chính ${MARKER}`
const IMPORTER = 'toannd'

const TARGETS: { projectCode: string; file: string }[] = [
  { projectCode: '25-VPI-I-095', file: 'I-095-ENG-001-REV 34.xlsx' },
  { projectCode: '25-VPI-078', file: 'I-078-ENG-001-REV 12.xlsx' },
  { projectCode: '25-WNC-I-097', file: 'I-097-ENG-001-REV 22.xlsx' },
]

async function main() {
  console.log(`=== Import BOM lô 2 (095/078/097) — ${APPLY ? 'APPLY' : 'DRY-RUN'} ===\n`)
  const importer = await prisma.user.findUnique({ where: { username: IMPORTER }, select: { id: true } })
  if (!importer) { console.error(`❌ Không tìm thấy user ${IMPORTER}`); process.exit(1) }

  for (const t of TARGETS) {
    const project = await prisma.project.findUnique({ where: { projectCode: t.projectCode }, select: { id: true } })
    if (!project) { console.log(`⏭  SKIP ${t.projectCode}: không tìm thấy dự án`); continue }

    // 1) container task idempotent (theo marker)
    const existing = await prisma.task.findFirst({
      where: { projectId: project.id, taskType: 'P2.1', title: { contains: MARKER } },
      select: { id: true },
    })

    // 2) parse thật
    const items = parseFile(path.join(BOM_DIR, t.file))
    // 3) enrich MATCH-ONLY (không tạo material tạm)
    const enriched = await enrichBomPrItems(items as never, t.projectCode, { matchOnly: true })
    const matched = enriched.filter((i: Record<string, unknown>) => !!i.materialId).length
    const nullMat = enriched.length - matched
    const vtc01Net = enriched.filter((i: Record<string, unknown>) => /vtc01/i.test(String(i.stt || '')))
      .reduce((s: number, i: Record<string, unknown>) => s + (Number(i.netWeight) || 0), 0)

    console.log(`▶ ${t.projectCode}  (${t.file})`)
    console.log(`   container task: ${existing ? `tái dùng ${existing.id}` : `SẼ TẠO MỚI (taskType=P2.1, status=DONE)`}`)
    console.log(`   parse: ${items.length} item | enrich match-only: ${matched} khớp kho / ${nullMat} materialId=null`)
    console.log(`   VTC01 netWeight: ${Math.round(vtc01Net).toLocaleString()} kg`)

    if (APPLY) {
      const bomPrItems = JSON.stringify(enriched)
      let taskId = existing?.id
      if (!taskId) {
        const created = await prisma.task.create({
          data: {
            title: TITLE, projectId: project.id, taskType: 'P2.1', status: 'DONE',
            description: `Container dữ liệu BOM/VT chính nhập từ Drive (ENG-001). ${items.length} item.`,
            createdBy: importer.id,
            resultData: { bomPrItems },
          },
          select: { id: true },
        })
        taskId = created.id
        console.log(`   ✓ đã tạo task ${taskId}`)
      } else {
        const cur = await prisma.task.findUnique({ where: { id: taskId }, select: { resultData: true } })
        const rd = (cur?.resultData && typeof cur.resultData === 'object') ? cur.resultData as Record<string, unknown> : {}
        await prisma.task.update({ where: { id: taskId }, data: { resultData: { ...rd, bomPrItems } } })
        console.log(`   ✓ đã ghi đè bomPrItems vào task ${taskId}`)
      }
    }
    console.log('')
  }

  console.log(APPLY ? '✅ ĐÃ GHI DB' : '🔍 DRY-RUN — chưa ghi. Chạy với --apply để nạp.')
  await prisma.$disconnect()
}

main().catch(err => { console.error('❌ Lỗi:', err); process.exit(1) })
