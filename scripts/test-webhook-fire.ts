/**
 * Fire a test webhook for a sale-originated task.
 * Usage: npx tsx scripts/test-webhook-fire.ts [taskId|externalRef]
 *
 * If no argument, picks the most recently updated sale task.
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { createHmac, randomUUID } from 'crypto'

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
  const ref = process.argv[2]

  // Find a sale task
  const task = ref
    ? await prisma.task.findFirst({
        where: { OR: [{ id: ref }, { externalRef: ref }], externalSource: 'sale' },
        include: { assignees: true },
      })
    : await prisma.task.findFirst({
        where: { externalSource: 'sale', externalRef: { not: null } },
        include: { assignees: true },
        orderBy: { updatedAt: 'desc' },
      })

  if (!task) {
    console.error('No sale-originated task found')
    process.exit(1)
  }

  console.log(`Task: ${task.id}`)
  console.log(`  externalRef: ${task.externalRef}`)
  console.log(`  status: ${task.status}`)

  // Find the API client
  const rd = (task.resultData && typeof task.resultData === 'object') ? (task.resultData as Record<string, unknown>) : {}
  const externalClientId = typeof rd.externalClientId === 'string' ? rd.externalClientId : null

  if (!externalClientId) {
    console.error('  ✗ No externalClientId in resultData — run fix-sale-webhook.ts first')
    process.exit(1)
  }

  const client = await prisma.apiClient.findFirst({
    where: { id: externalClientId, active: true },
  })
  if (!client) {
    console.error(`  ✗ ApiClient ${externalClientId} not found or inactive`)
    process.exit(1)
  }
  if (!client.callbackUrl) {
    console.error(`  ✗ ApiClient "${client.name}" has no callbackUrl — run fix-sale-webhook.ts first`)
    process.exit(1)
  }

  console.log(`  client: ${client.name}`)
  console.log(`  callbackUrl: ${client.callbackUrl}`)

  // Fetch evidence files
  const evidenceFiles = await prisma.fileAttachment.findMany({
    where: { entityType: 'TaskEvidence', entityId: { startsWith: `${task.id}_` } },
    select: { id: true, fileName: true, fileSize: true, mimeType: true },
    orderBy: { createdAt: 'asc' },
  })

  // Build payload
  const userIds = task.assignees.map(a => a.userId).filter((uid): uid is string => !!uid)
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })
    : []
  const nameById = new Map(users.map(u => [u.id, u.fullName]))

  const event = 'task.updated'
  const payload = {
    event,
    externalRef: task.externalRef,
    taskId: task.id,
    status: task.status,
    previousStatus: task.status,
    blocked: task.blocked,
    assignees: task.assignees.map(a => ({
      userId: a.userId || null,
      fullName: a.userId ? (nameById.get(a.userId) || null) : null,
      roleCode: a.role,
    })),
    deadline: task.deadline,
    decision: '',
    updatedAt: task.updatedAt,
    completedAt: task.completedAt || null,
    evidenceFiles: evidenceFiles.map(f => ({
      fileId: f.id,
      fileName: f.fileName,
      fileSize: f.fileSize,
      mimeType: f.mimeType,
      downloadUrl: `/api/external/v1/files/${f.id}`,
    })),
  }

  const body = JSON.stringify(payload)
  const signature = createHmac('sha256', client.webhookSecret).update(body).digest('hex')
  const deliveryId = randomUUID()
  const url = `${client.callbackUrl.replace(/\/+$/, '')}/${event.replace(/\./g, '-')}`

  console.log(`\nFiring webhook:`)
  console.log(`  URL: ${url}`)
  console.log(`  Delivery: ${deliveryId}`)
  console.log(`  Evidence files: ${evidenceFiles.length}`)
  console.log(`  Payload:`)
  console.log(JSON.stringify(payload, null, 2))
  console.log()

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-IBS-Event': event,
        'X-IBS-Delivery': deliveryId,
        'X-IBS-Signature': signature,
      },
      body,
      signal: AbortSignal.timeout(15000),
    })

    console.log(`Response: ${res.status} ${res.statusText}`)
    const text = await res.text()
    if (text) console.log(`Body: ${text.substring(0, 500)}`)

    if (res.ok) {
      console.log('\n✓ Webhook delivered successfully')
    } else {
      console.log('\n✗ Webhook delivery failed')
    }
  } catch (err) {
    console.error('\n✗ Webhook request error:', (err as Error).message)
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
