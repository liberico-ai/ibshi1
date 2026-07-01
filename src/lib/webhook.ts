import { createHmac, randomUUID } from 'crypto'
import prisma from './db'

interface WebhookClient {
  id: string
  name: string
  callbackUrl: string | null
  webhookSecret: string
}

const RETRY_DELAYS = [1000, 5000, 30000]

// ── Generic webhook sender — POST to ${callbackUrl}/${event} ──

export async function sendWebhook(
  client: WebhookClient,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!client.callbackUrl) return

  const fullPayload = { event, ...payload }
  const body = JSON.stringify(fullPayload)
  const signature = createHmac('sha256', client.webhookSecret).update(body).digest('hex')
  const deliveryId = randomUUID()
  const url = `${client.callbackUrl.replace(/\/+$/, '')}/${event}`

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
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
        signal: AbortSignal.timeout(10000),
      })

      if (res.ok) {
        console.log(`[Webhook] Delivered ${event} ${deliveryId} to ${client.name}: ${res.status}`)
        return
      }

      console.warn(`[Webhook] ${client.name} returned ${res.status} for ${event} (attempt ${attempt + 1})`)
    } catch (err) {
      console.warn(`[Webhook] ${client.name} failed ${event} (attempt ${attempt + 1}):`, (err as Error).message)
    }

    if (attempt < RETRY_DELAYS.length) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]))
    }
  }

  console.error(`[Webhook] ${client.name}: exhausted retries for ${event} delivery ${deliveryId}`)
}

// ── Broadcast to all active clients with callbackUrl ──

async function getWebhookClients(): Promise<WebhookClient[]> {
  return prisma.apiClient.findMany({
    where: { active: true, callbackUrl: { not: null } },
    select: { id: true, name: true, callbackUrl: true, webhookSecret: true },
  })
}

export async function broadcastWebhook(event: string, payload: Record<string, unknown>): Promise<void> {
  const clients = await getWebhookClients()
  for (const client of clients) {
    sendWebhook(client, event, payload).catch(err => {
      console.error(`[Webhook] Broadcast error for ${client.name}/${event}:`, err)
    })
  }
}

// ── task.updated — sends to the client that created the task ──

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

    const payload: Record<string, unknown> = {
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
      completedAt: task.completedAt || null,
    }

    const externalClientId = typeof rd.externalClientId === 'string' ? rd.externalClientId : null
    if (!externalClientId) return

    const client = await prisma.apiClient.findFirst({
      where: { id: externalClientId, active: true, callbackUrl: { not: null } },
    })
    if (!client) return

    sendWebhook(client, 'task.updated', payload).catch(err => {
      console.error(`[Webhook] Fire-and-forget error for ${client.name}:`, err)
    })
  } catch (err) {
    console.error('[Webhook] emitTaskUpdated error:', err)
  }
}

// ── project.approved / project.rejected ──

export async function emitProjectApproved(submissionId: string): Promise<void> {
  try {
    const sub = await prisma.projectSubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return

    await broadcastWebhook('project.approved', {
      externalRef: sub.externalRef,
      projectId: sub.projectId,
      projectCode: sub.projectCode,
    })
  } catch (err) {
    console.error('[Webhook] emitProjectApproved error:', err)
  }
}

export async function emitProjectRejected(submissionId: string): Promise<void> {
  try {
    const sub = await prisma.projectSubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return

    await broadcastWebhook('project.rejected', {
      externalRef: sub.externalRef,
      reason: sub.reason || null,
    })
  } catch (err) {
    console.error('[Webhook] emitProjectRejected error:', err)
  }
}

// ── task.created — helper to send Sale-bound task notification ──
// No auto-trigger — call manually when a task targets Sale.

export async function emitTaskCreated(taskId: string): Promise<void> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        project: { select: { projectCode: true } },
        assignees: { select: { role: true, userId: true } },
      },
    })
    if (!task) return

    const userIds = task.assignees.map(a => a.userId).filter((uid): uid is string => !!uid)
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })
      : []
    const nameById = new Map(users.map(u => [u.id, u.fullName]))

    await broadcastWebhook('task.created', {
      ibsTaskId: task.id,
      title: task.title,
      description: task.description || null,
      priority: task.priority,
      projectCode: task.project?.projectCode || null,
      deadline: task.deadline,
      assignees: task.assignees.map(a => ({
        userId: a.userId || null,
        fullName: a.userId ? (nameById.get(a.userId) || null) : null,
        roleCode: a.role,
      })),
      createdAt: task.createdAt,
    })
  } catch (err) {
    console.error('[Webhook] emitTaskCreated error:', err)
  }
}

// ── departments.changed ──

export async function emitDepartmentsChanged(summary: string): Promise<void> {
  try {
    await broadcastWebhook('departments.changed', { summary })
  } catch (err) {
    console.error('[Webhook] emitDepartmentsChanged error:', err)
  }
}

// ── contract.updated ──

export async function emitContractUpdated(projectId: string, lastChange: string): Promise<void> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, projectCode: true, contractValue: true, status: true },
    })
    if (!project) return

    const sub = await prisma.projectSubmission.findFirst({
      where: { projectId },
      select: { externalRef: true },
    })

    await broadcastWebhook('contract.updated', {
      contractId: project.projectCode,
      externalRef: sub?.externalRef || null,
      status: project.status,
      contractValue: project.contractValue ? Number(project.contractValue) : null,
      lastChange,
    })
  } catch (err) {
    console.error('[Webhook] emitContractUpdated error:', err)
  }
}

// ── capacity.changed ──

export async function emitCapacityChanged(changeType: string, summary: string): Promise<void> {
  try {
    await broadcastWebhook('capacity.changed', { changeType, summary })
  } catch (err) {
    console.error('[Webhook] emitCapacityChanged error:', err)
  }
}
