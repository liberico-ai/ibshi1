/**
 * Create an API client for external integration.
 * Usage: npx tsx scripts/create-api-client.ts <name> [scopes...]
 * Example: npx tsx scripts/create-api-client.ts "Sale System" read:projects read:tasks write:tasks
 *
 * The API key is printed ONCE — store it securely. Only the hash is saved to DB.
 */

import { createHash, randomBytes } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

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
  const [, , name, ...scopes] = process.argv
  if (!name) {
    console.error('Usage: npx tsx scripts/create-api-client.ts <name> [scopes...]')
    console.error('Scopes: read:projects, read:tasks, write:tasks')
    process.exit(1)
  }

  if (scopes.length === 0) {
    scopes.push('read:projects', 'read:tasks')
  }

  const raw = randomBytes(32).toString('hex')
  const key = `ibsk_live_${raw}`
  const prefix = key.substring(0, 22)
  const hash = createHash('sha256').update(key).digest('hex')
  const webhookSecret = randomBytes(32).toString('hex')

  // Ensure api-system user exists (needed for POST /tasks createdBy)
  const existing = await prisma.user.findUnique({ where: { username: 'api-system' } })
  if (!existing) {
    const bcrypt = await import('bcryptjs')
    await prisma.user.create({
      data: {
        username: 'api-system',
        fullName: 'API System',
        roleCode: 'R10',
        passwordHash: await bcrypt.hash(randomBytes(32).toString('hex'), 12),
        isActive: true,
      },
    })
    console.log('  Created api-system user')
  }

  const client = await prisma.apiClient.create({
    data: {
      name,
      keyPrefix: prefix,
      keyHash: hash,
      webhookSecret,
      scopes,
    },
  })

  console.log('═══════════════════════════════════════════')
  console.log('  API Client created successfully')
  console.log('═══════════════════════════════════════════')
  console.log(`  Name:           ${client.name}`)
  console.log(`  ID:             ${client.id}`)
  console.log(`  Scopes:         ${scopes.join(', ')}`)
  console.log(`  Webhook Secret: ${webhookSecret}`)
  console.log('')
  console.log(`  API Key: ${key}`)
  console.log('')
  console.log('  ⚠  Store the API key securely — it will NOT be shown again.')
  console.log('═══════════════════════════════════════════')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
