import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { NextRequest } from 'next/server'
import prisma from './db'

interface ApiClient {
  id: string
  name: string
  keyPrefix: string
  keyHash: string
  webhookSecret: string
  callbackUrl: string | null
  scopes: string[]
  active: boolean
  lastUsedAt: Date | null
  createdAt: Date
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const raw = randomBytes(32).toString('hex')
  const key = `ibsk_live_${raw}`
  const prefix = key.substring(0, 22)
  const hash = createHash('sha256').update(key).digest('hex')
  return { key, prefix, hash }
}

export async function authenticateApiClient(req: NextRequest): Promise<ApiClient | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ibsk_')) return null

  const key = authHeader.substring(7)
  const prefix = key.substring(0, 22)
  const hash = createHash('sha256').update(key).digest('hex')

  const client = await prisma.apiClient.findUnique({ where: { keyPrefix: prefix } })
  if (!client || !client.active) return null

  const hashBuf = Buffer.from(hash, 'hex')
  const storedBuf = Buffer.from(client.keyHash, 'hex')
  if (hashBuf.length !== storedBuf.length || !timingSafeEqual(hashBuf, storedBuf)) return null

  prisma.apiClient.update({
    where: { id: client.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {})

  return client
}

export function requireScope(client: ApiClient, scope: string): boolean {
  return client.scopes.includes(scope)
}
