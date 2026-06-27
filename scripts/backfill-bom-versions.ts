/**
 * Backfill: tạo BomVersion v1 ACTIVE cho mỗi BillOfMaterial hiện có,
 * gán bomVersionId cho tất cả BomItem tương ứng.
 *
 * Chạy: NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/backfill-bom-versions.ts
 * Dry-run: thêm flag --dry-run
 */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import 'dotenv/config'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adapter = new PrismaPg(pool as any)
const prisma = new PrismaClient({ adapter })
const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  console.log(`[backfill-bom-versions] ${DRY_RUN ? 'DRY RUN' : 'LIVE'} mode`)

  const boms = await prisma.billOfMaterial.findMany({
    select: { id: true, bomCode: true, createdBy: true },
  })

  console.log(`Found ${boms.length} BOMs to backfill`)

  let created = 0
  let itemsLinked = 0

  for (const bom of boms) {
    const existing = await prisma.bomVersion.findFirst({
      where: { bomId: bom.id },
    })
    if (existing) {
      console.log(`  SKIP ${bom.bomCode} — already has version(s)`)
      continue
    }

    if (DRY_RUN) {
      const itemCount = await prisma.bomItem.count({ where: { bomId: bom.id } })
      console.log(`  WOULD create v1 ACTIVE for ${bom.bomCode} (${itemCount} items)`)
      created++
      itemsLinked += itemCount
      continue
    }

    const version = await prisma.bomVersion.create({
      data: {
        bomId: bom.id,
        versionNo: 1,
        status: 'ACTIVE',
        createdBy: bom.createdBy,
      },
    })

    const result = await prisma.bomItem.updateMany({
      where: { bomId: bom.id, bomVersionId: null },
      data: { bomVersionId: version.id },
    })

    console.log(`  OK ${bom.bomCode} → v1 (${result.count} items linked)`)
    created++
    itemsLinked += result.count
  }

  console.log(`\nDone: ${created} versions created, ${itemsLinked} items linked`)
  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  prisma.$disconnect()
  process.exit(1)
})
