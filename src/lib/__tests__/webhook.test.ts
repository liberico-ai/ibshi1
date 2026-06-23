import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'

vi.mock('@/lib/db')

const { mockPrisma } = vi.hoisted(() => {
  return { mockPrisma: null }
})

// Avoid unused var
void mockPrisma

import { prismaMock } from '@/lib/__mocks__/db'

describe('webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  describe('sendTaskWebhook — HMAC signature', () => {
    it('signs payload with HMAC-SHA256 and sends correct headers', async () => {
      const capturedHeaders: Record<string, string> = {}
      let capturedBody = ''

      vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        const headers = init.headers as Record<string, string>
        Object.assign(capturedHeaders, headers)
        capturedBody = init.body as string
        return { ok: true, status: 200 }
      }))

      const { sendTaskWebhook } = await import('@/lib/webhook')

      const client = { id: 'c1', name: 'Test', callbackUrl: 'https://example.com/hook', webhookSecret: 'my-secret-key' }
      const payload = {
        event: 'task.updated',
        externalRef: 'SALE-001',
        taskId: 'task-1',
        status: 'DONE',
        previousStatus: 'IN_PROGRESS',
        blocked: false,
        assignees: [],
        deadline: null,
        decision: '',
        updatedAt: '2026-06-22T00:00:00.000Z',
      }

      await sendTaskWebhook(client, payload)

      const expectedSig = createHmac('sha256', 'my-secret-key')
        .update(capturedBody)
        .digest('hex')

      expect(capturedHeaders['X-IBS-Signature']).toBe(expectedSig)
      expect(capturedHeaders['X-IBS-Event']).toBe('task.updated')
      expect(capturedHeaders['X-IBS-Delivery']).toBeDefined()
      expect(capturedHeaders['Content-Type']).toBe('application/json')
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('retries on failure', async () => {
      vi.useFakeTimers()
      let callCount = 0
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount <= 2) return { ok: false, status: 500 }
        return { ok: true, status: 200 }
      }))

      const { sendTaskWebhook } = await import('@/lib/webhook')

      const client = { id: 'c1', name: 'Test', callbackUrl: 'https://example.com/hook', webhookSecret: 'secret' }
      const payload = {
        event: 'task.updated', externalRef: 'S-1', taskId: 't-1',
        status: 'DONE', previousStatus: 'OPEN', blocked: false,
        assignees: [], deadline: null, decision: '', updatedAt: '2026-01-01T00:00:00Z',
      }

      const promise = sendTaskWebhook(client, payload)
      await vi.advanceTimersByTimeAsync(1000)
      await vi.advanceTimersByTimeAsync(5000)
      await promise
      expect(callCount).toBe(3)
      vi.useRealTimers()
    })

    it('does nothing when callbackUrl is null', async () => {
      vi.stubGlobal('fetch', vi.fn())

      const { sendTaskWebhook } = await import('@/lib/webhook')

      const client = { id: 'c1', name: 'Test', callbackUrl: null, webhookSecret: 'secret' }
      await sendTaskWebhook(client, {} as any)
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  describe('emitTaskUpdated — filtering', () => {
    it('does NOT emit for tasks without externalRef', async () => {
      prismaMock.task.findUnique.mockResolvedValue({
        id: 'task-1', externalRef: null, externalSource: null,
        status: 'DONE', blocked: false, assignees: [],
        resultData: null, updatedAt: new Date(), deadline: null,
      } as any)

      vi.stubGlobal('fetch', vi.fn())

      const { emitTaskUpdated } = await import('@/lib/webhook')
      await emitTaskUpdated('task-1', 'OPEN')

      expect(fetch).not.toHaveBeenCalled()
    })

    it('does NOT emit for tasks with externalSource != sale', async () => {
      prismaMock.task.findUnique.mockResolvedValue({
        id: 'task-1', externalRef: 'EXT-1', externalSource: 'other',
        status: 'DONE', blocked: false, assignees: [],
        resultData: null, updatedAt: new Date(), deadline: null,
      } as any)

      vi.stubGlobal('fetch', vi.fn())

      const { emitTaskUpdated } = await import('@/lib/webhook')
      await emitTaskUpdated('task-1', 'OPEN')

      expect(fetch).not.toHaveBeenCalled()
    })

    it('does NOT emit when externalClientId is missing', async () => {
      prismaMock.task.findUnique.mockResolvedValue({
        id: 'task-1', externalRef: 'SALE-001', externalSource: 'sale',
        status: 'DONE', blocked: false,
        assignees: [], resultData: { briefing: {} },
        updatedAt: new Date(), deadline: null,
      } as any)

      prismaMock.user.findMany.mockResolvedValue([])
      vi.stubGlobal('fetch', vi.fn())

      const { emitTaskUpdated } = await import('@/lib/webhook')
      await emitTaskUpdated('task-1', 'OPEN')

      expect(fetch).not.toHaveBeenCalled()
    })

    it('emits only to owning client via externalClientId', async () => {
      prismaMock.task.findUnique.mockResolvedValue({
        id: 'task-1', externalRef: 'SALE-001', externalSource: 'sale',
        status: 'DONE', blocked: false,
        assignees: [{ userId: 'u1', role: 'R02', isPrimary: true }],
        resultData: { externalClientId: 'c1', briefing: { decision: 'approved' } },
        updatedAt: new Date(), deadline: null,
      } as any)

      prismaMock.user.findMany.mockResolvedValue([
        { id: 'u1', fullName: 'User One' },
      ] as any)

      prismaMock.apiClient.findFirst.mockResolvedValue({
        id: 'c1', name: 'Sale', callbackUrl: 'https://sale.example.com/webhook', webhookSecret: 'sec', active: true,
      } as any)

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))

      const { emitTaskUpdated } = await import('@/lib/webhook')
      await emitTaskUpdated('task-1', 'IN_PROGRESS')

      expect(prismaMock.apiClient.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'c1' }) }),
      )
      await new Promise(r => setTimeout(r, 50))
      expect(fetch).toHaveBeenCalledTimes(1)
    })
  })
})
