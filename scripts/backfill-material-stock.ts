/**
 * Backfill MaterialStock from Material.currentStock into VCND (COMMON) warehouse.
 *
 * Handles 3 safe groups (auto-fix) + 1 manual group (report only):
 *
 * AUTO:
 *   A. Materials with currentStock > 0 but NO MaterialStock row → create into VCND
 *   B. Materials where currentStock > SUM(MS) (delta positive) → upsert diff into VCND
 *   C. FP noise (|diff| < 0.001) → snap VCND to absorb rounding
 *
 * MANUAL (delta negative — SUM > currentStock):
 *   D. Print per-warehouse breakdown for Kho to decide which warehouse to reduce.
 *      NO auto-fix — these stay as known invariant exceptions until resolved.
 *
 * Idempotent: safe to run multiple times.
 *
 * Usage:
 *   npx tsx scripts/backfill-material-stock.ts --dry-run   # preview only
 *   npx tsx scripts/backfill-material-stock.ts              # execute
 */

import { PrismaClient, Prisma } from '@prisma/client'

const prisma = new PrismaClient()
const DRY_RUN = process.argv.includes('--dry-run')

interface MismatchRow {
  id: string
  code: string
  cs: Prisma.Decimal
  ss: Prisma.Decimal
  ms_rows: bigint
}

async function main() {
  console.log(`\n=== Backfill MaterialStock → VCND (COMMON) ===`)
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'EXECUTE'}\n`)

  // 1. Ensure VCND warehouse exists
  let vcnd = await prisma.warehouse.findUnique({ where: { code: 'VCND' } })
  if (!vcnd) {
    if (DRY_RUN) {
      console.log('[DRY] Would create VCND warehouse\n')
      vcnd = { id: 'dry-run-vcnd' } as any
    } else {
      vcnd = await prisma.warehouse.create({
        data: { code: 'VCND', name: 'Vật liệu chính nội địa', kind: 'COMMON' },
      })
      console.log(`Created VCND warehouse: ${vcnd.id}\n`)
    }
  }

  // 2. Find ALL mismatched materials
  const mismatched = await prisma.$queryRaw<MismatchRow[]>`
    SELECT m.id, m.material_code as code,
      m.current_stock as cs,
      COALESCE(SUM(ms.quantity), 0) as ss,
      COUNT(ms.id) as ms_rows
    FROM materials m
    LEFT JOIN material_stocks ms ON ms.material_id = m.id
    GROUP BY m.id
    HAVING m.current_stock != COALESCE(SUM(ms.quantity), 0)
    ORDER BY ABS(m.current_stock - COALESCE(SUM(ms.quantity), 0)) DESC
  `

  console.log(`Total mismatched materials: ${mismatched.length}`)

  // Categorize
  const groupA: typeof mismatched = [] // no rows
  const groupB: typeof mismatched = [] // delta positive (currentStock > SUM)
  const groupC: typeof mismatched = [] // FP noise
  const groupD: typeof mismatched = [] // delta negative (SUM > currentStock) — manual

  for (const row of mismatched) {
    const diff = Number(row.cs) - Number(row.ss)
    if (Number(row.ms_rows) === 0) {
      groupA.push(row)
    } else if (Math.abs(diff) < 0.001) {
      groupC.push(row)
    } else if (diff > 0) {
      groupB.push(row)
    } else {
      groupD.push(row)
    }
  }

  const autoCount = groupA.length + groupB.length + groupC.length
  console.log(`  [AUTO] A. No MS rows (create):    ${groupA.length}`)
  console.log(`  [AUTO] B. Delta positive (upsert): ${groupB.length}`)
  console.log(`  [AUTO] C. FP noise (snap):         ${groupC.length}`)
  console.log(`  [MANUAL] D. Delta negative (skip): ${groupD.length}`)
  console.log(`  Total auto-fix: ${autoCount}\n`)

  // 3. Preview auto groups
  const showAuto = (label: string, items: typeof mismatched) => {
    if (items.length === 0) return
    console.log(`${label}:`)
    for (const r of items.slice(0, 15)) {
      const diff = Number(r.cs) - Number(r.ss)
      console.log(`  ${r.code}: currentStock=${Number(r.cs)}, SUM(MS)=${Number(r.ss)}, bù=${diff.toFixed(6)} → VCND`)
    }
    if (items.length > 15) console.log(`  ... and ${items.length - 15} more`)
    console.log()
  }
  showAuto('GROUP A — No MaterialStock rows', groupA)
  showAuto('GROUP B — Delta positive (currentStock > SUM)', groupB)
  showAuto('GROUP C — FP noise', groupC)

  // 4. Manual group D — per-warehouse breakdown
  if (groupD.length > 0) {
    console.log('════════════════════════════════════════════════════════')
    console.log('DANH SÁCH RÀ TAY (delta âm — SUM > currentStock)')
    console.log('Kho cần quyết giảm ở warehouse nào. KHÔNG auto-fix.')
    console.log('════════════════════════════════════════════════════════')
    for (const row of groupD) {
      const diff = Number(row.cs) - Number(row.ss)
      console.log(`\n  ${row.code}: currentStock=${Number(row.cs)}, SUM(MS)=${Number(row.ss)}, thừa=${Math.abs(diff)}`)

      const stocks = await prisma.materialStock.findMany({
        where: { materialId: row.id },
        include: { warehouse: { select: { code: true, name: true } } },
        orderBy: { quantity: 'desc' },
      })
      for (const s of stocks) {
        console.log(`    kho ${s.warehouse.code} (${s.warehouse.name}): ${Number(s.quantity)}`)
      }
    }
    console.log('\n════════════════════════════════════════════════════════\n')
  }

  if (DRY_RUN) {
    console.log(`[DRY RUN] Would auto-fix ${autoCount} materials. ${groupD.length} ca delta âm cần rà tay.`)
    console.log(`Run without --dry-run to execute auto-fix.`)
    return
  }

  if (autoCount === 0) {
    console.log('Nothing to auto-fix.')
    return
  }

  // 5a. Group A: create new MaterialStock rows
  if (groupA.length > 0) {
    const BATCH = 100
    for (let i = 0; i < groupA.length; i += BATCH) {
      const batch = groupA.slice(i, i + BATCH)
      await prisma.materialStock.createMany({
        data: batch.map(m => ({
          materialId: m.id,
          warehouseId: vcnd!.id,
          quantity: Number(m.cs),
        })),
        skipDuplicates: true,
      })
    }
    console.log(`✓ Created ${groupA.length} new MaterialStock rows (Group A)`)
  }

  // 5b. Group B: upsert positive diff into VCND
  for (const row of groupB) {
    const diff = Number(row.cs) - Number(row.ss)
    await prisma.materialStock.upsert({
      where: { materialId_warehouseId: { materialId: row.id, warehouseId: vcnd!.id } },
      create: { materialId: row.id, warehouseId: vcnd!.id, quantity: diff },
      update: { quantity: { increment: diff } },
    })
  }
  if (groupB.length > 0) console.log(`✓ Adjusted ${groupB.length} MaterialStock rows (Group B — delta positive)`)

  // 5c. Group C: snap FP noise
  for (const row of groupC) {
    const diff = Number(row.cs) - Number(row.ss)
    await prisma.materialStock.upsert({
      where: { materialId_warehouseId: { materialId: row.id, warehouseId: vcnd!.id } },
      create: { materialId: row.id, warehouseId: vcnd!.id, quantity: diff },
      update: { quantity: { increment: diff } },
    })
  }
  if (groupC.length > 0) console.log(`✓ Snapped ${groupC.length} MaterialStock rows (Group C — FP noise)`)

  // 6. Final invariant check (excluding known Group D exceptions)
  const remaining = await prisma.$queryRaw<{ cnt: bigint }[]>`
    SELECT COUNT(*) as cnt FROM (
      SELECT m.id
      FROM materials m
      LEFT JOIN material_stocks ms ON ms.material_id = m.id
      GROUP BY m.id
      HAVING ABS(m.current_stock::numeric - COALESCE(SUM(ms.quantity), 0)::numeric) > 0.001
    ) sub
  `

  const cnt = Number(remaining[0]?.cnt || 0)
  const expected = groupD.length
  if (cnt > expected) {
    console.warn(`\n⚠ ${cnt} materials still mismatched (expected ${expected} known exceptions). Investigate.`)
  } else if (cnt === expected) {
    console.log(`\n✓ Invariant OK: ${cnt} known exceptions (delta âm, rà tay). Tất cả ${autoCount} ca auto đã sạch.`)
  } else {
    console.log(`\n✓ Invariant OK: only ${cnt} materials with mismatch > 0.001`)
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
