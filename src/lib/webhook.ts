import { createHmac, randomUUID } from 'crypto'
import prisma from './db'

interface WebhookPayload {
  event: string
  externalRef: string
  taskId: string
  status: string
  previousStatus: string
  blocked: boolean
  assignees: { userId: string | null; fullName: string | null; roleCode: string | null }[]
  deadline: Date | string | null
  decision: string
  updatedAt: Date | string
}

interface WebhookClient {
  id: string
  name: string
  callbackUrl: string | null
  webhookSecret: string
}

const RETRY_DELAYS = [1000, 5000, 30000]

export async function sendTaskWebhook(client: WebhookClient, payload: WebhookPayload): Promise<void> {
  if (!client.callbackUrl) return

  const body = JSON.stringify(payload)
  const signature = createHmac('sha256', client.webhookSecret).update(body).digest('hex')
  const deliveryId = randomUUID()

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const res = await fetch(client.callbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-IBS-Event': payload.event,
          'X-IBS-Delivery': deliveryId,
          'X-IBS-Signature': signature,
        },
        body,
        signal: AbortSignal.timeout(10000),
      })

      if (res.ok) {
        console.log(`[Webhook] Delivered ${deliveryId} to ${client.name}: ${res.status}`)
        return
      }

      console.warn(`[Webhook] ${client.name} returned ${res.status} (attempt ${attempt + 1})`)
    } catch (err) {
      console.warn(`[Webhook] ${client.name} failed (attempt ${attempt + 1}):`, (err as Error).message)
    }

    if (attempt < RETRY_DELAYS.length) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]))
    }
  }

  console.error(`[Webhook] ${client.name}: exhausted retries for delivery ${deliveryId}`)
}

export async function emitTaskUpdated(taskId: string, previousStatus?: string): Promise<void> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { assignees: true },
    })

    if (!task || !task.externalRef || task.externalSource !== 'sale') return

    const userIds = task.assignees.map(a => a.userId).filter((uid): uid is string => !!uid)
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })
      : []
    const nameById = new Map(users.map(u => [u.id, u.fullName]))

    const rd = (task.resultData && typeof task.resultData === 'object') ? (task.resultData as Record<string, unknown>) : {}
    const briefing = (rd.briefing && typeof rd.briefing === 'object') ? (rd.briefing as Record<string, unknown>) : {}
    const decision = typeof briefing.decision === 'string' ? briefing.decision : ''

    const payload: WebhookPayload = {
      event: 'task.updated',
      externalRef: task.externalRef,
      taskId: task.id,
      status: task.status,
      previousStatus: previousStatus || task.status,
      blocked: task.blocked,
      assignees: task.assignees.map(a => ({
        userId: a.userId || null,
        fullName: a.userId ? (nameById.get(a.userId) || null) : null,
        roleCode: a.role,
      })),
      deadline: task.deadline,
      decision,
      updatedAt: task.updatedAt,
    }

    const clients = await prisma.apiClient.findMany({
      where: { active: true, callbackUrl: { not: null } },
    })

    for (const client of clients) {
      sendTaskWebhook(client, payload).catch(err => {
        console.error(`[Webhook] Fire-and-forget error for ${client.name}:`, err)
      })
    }
  } catch (err) {
    console.error('[Webhook] emitTaskUpdated error:', err)
  }
}
