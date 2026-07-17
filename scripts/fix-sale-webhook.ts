/**
 * Fix Sale webhook integration:
 * 1. Update callbackUrl to correct endpoint
 * 2. Backfill externalClientId in resultData for sale tasks that lost it
 *
 * Usage: npx tsx scripts/fix-sale-webhook.ts [--dry-run]
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const CORRECT_CALLBACK_URL = 'https://sale-platform-v4.lab.liberico.com.vn/webhooks/ibs'

const dryRun = process.argv.includes('--dry-run')

const connectionString = process.env.DATABASE_URL
if (!connectionString) { console.error('DATABASE_URL required'); process.exit(1) }
const isRemote = !connectionString.includes('@localhost') && !connectionString.includes('@127.0.0.1')
const pool = new pg.Pool({
  connectionString,
  max: 5,
  ...(isRemote && { ssl: { rejectUnauthorized: false } }),
})
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter: new PrismaPg(pool as any) })

async function main() {
  console.log(dryRun ? '=== DRY RUN ===' : '=== LIVE RUN ===')

  // ── Step 1: Fix callbackUrl on Sale API clients ──
  const saleClients = await prisma.apiClient.findMany({
    where: { active: true },
    select: { id: true, name: true, callbackUrl: true },
  })

  console.log(`\nFound ${saleClients.length} active API client(s):`)
  for (const c of saleClients) {
    console.log(`  ${c.name} (${c.id}): callbackUrl = ${c.callbackUrl || '(null)'}`)

    if (c.callbackUrl === CORRECT_CALLBACK_URL) {
      console.log(`    ✓ Already correct`)
      continue
    }

    console.log(`    → Updating to: ${CORRECT_CALLBACK_URL}`)
    if (!dryRun) {
      await prisma.apiClient.update({
        where: { id: c.id },
        data: { callbackUrl: CORRECT_CALLBACK_URL },
      })
      console.log(`    ✓ Updated`)
    }
  }

  // ── Step 2: Backfill externalClientId for sale tasks ──
  const saleTasks = await prisma.task.findMany({
    where: { externalSource: 'sale', externalRef: { not: null } },
    select: { id: true, externalRef: true, status: true, resultData: true },
  })

  console.log(`\nFound ${saleTasks.length} sale-originated task(s):`)

  // Find the sale client ID to use for backfill
  const saleClient = saleClients.find(c => c.name.toLowerCase().includes('sale')) || saleClients[0]
  if (!saleClient) {
    console.log('  No active API client found — cannot backfill externalClientId')
    return
  }
  console.log(`  Using client "${saleClient.name}" (${saleClient.id}) for backfill\n`)

  let fixed = 0
  let alreadyOk = 0
  for (const task of saleTasks) {
    const rd = (task.resultData && typeof task.resultData === 'object')
      ? (task.resultData as Record<string, unknown>)
      : {}

    if (typeof rd.externalClientId === 'string' && rd.externalClientId.length > 0) {
      alreadyOk++
      continue
    }

    console.log(`  Task ${task.id} (${task.externalRef}, ${task.status}): externalClientId missing`)
    console.log(`    → Setting externalClientId = ${saleClient.id}`)

    if (!dryRun) {
      await prisma.task.update({
        where: { id: task.id },
        data: {
          resultData: { ...rd, externalClientId: saleClient.id },
        },
      })
      console.log(`    ✓ Fixed`)
    }
    fixed++
  }

  console.log(`\nSummary:`)
  console.log(`  Tasks OK: ${alreadyOk}`)
  console.log(`  Tasks fixed: ${fixed}`)
  if (dryRun && fixed > 0) console.log(`  (dry run — no changes made, run without --dry-run to apply)`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
