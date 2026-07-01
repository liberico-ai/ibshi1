import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'

vi.mock('@/lib/db')

const { mockPrisma } = vi.hoisted(() => {
  return { mockPrisma: null }
})

void mockPrisma

import { prismaMock } from '@/lib/__mocks__/db'

describe('webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  describe('sendWebhook — HMAC signature + URL path', () => {
    it('signs payload with HMAC-SHA256, appends /<event> to URL, sends correct headers', async () => {
      const capturedHeaders: Record<string, string> = {}
      let capturedBody = ''
      let capturedUrl = ''

      vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        capturedUrl = url
        const headers = init.headers as Record<string, string>
        Object.assign(capturedHeaders, headers)
        capturedBody = init.body as string
        return { ok: true, status: 200 }
      }))

      const { sendWebhook } = await import('@/lib/webhook')

      const client = { id: 'c1', name: 'Test', callbackUrl: 'https://example.com/webhooks/ibs', webhookSecret: 'my-secret-key' }
      const payload = { externalRef: 'SALE-001', taskId: 'task-1', status: 'DONE' }

      await sendWebhook(client, 'task.updated', payload)

      expect(capturedUrl).toBe('https://example.com/webhooks/ibs/task.updated')

      const expectedSig = createHmac('sha256', 'my-secret-key')
        .update(capturedBody)
        .digest('hex')

      expect(capturedHeaders['X-IBS-Signature']).toBe(expectedSig)
      expect(capturedHeaders['X-IBS-Event']).toBe('task.updated')
      expect(capturedHeaders['X-IBS-Delivery']).toBeDefined()
      expect(capturedHeaders['Content-Type']).toBe('application/json')
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('includes event in payload body', async () => {
      let capturedBody = ''
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        capturedBody = init.body as string
        return { ok: true, status: 200 }
      }))

      const { sendWebhook } = await import('@/lib/webhook')
      const client = { id: 'c1', name: 'Test', callbackUrl: 'https://example.com/hook', webhookSecret: 'sec' }

      await sendWebhook(client, 'project.approved', { externalRef: 'REF-1', projectCode: 'P-001' })

      const parsed = JSON.parse(capturedBody)
      expect(parsed.event).toBe('project.approved')
      expect(parsed.externalRef).toBe('REF-1')
      expect(parsed.projectCode).toBe('P-001')
    })

    it('retries on failure', async () => {
      vi.useFakeTimers()
      let callCount = 0
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount <= 2) return { ok: false, status: 500 }
        return { ok: true, status: 200 }
      }))

      const { sendWebhook } = await import('@/lib/webhook')

      const client = { id: 'c1', name: 'Test', callbackUrl: 'https://example.com/hook', webhookSecret: 'secret' }
      const promise = sendWebhook(client, 'task.updated', { taskId: 't-1' })
      await vi.advanceTimersByTimeAsync(1000)
      await vi.advanceTimersByTimeAsync(5000)
      await promise
      expect(callCount).toBe(3)
      vi.useRealTimers()
    })

    it('does nothing when callbackUrl is null', async () => {
      vi.stubGlobal('fetch', vi.fn())

      const { sendWebhook } = await import('@/lib/webhook')

      const client = { id: 'c1', name: 'Test', callbackUrl: null, webhookSecret: 'secret' }
      await sendWebhook(client, 'test', {})
      expect(fetch).not.toHaveBeenCalled()
    })

    it('strips trailing slash from callbackUrl', async () => {
      let capturedUrl = ''
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
        capturedUrl = url
        return { ok: true, status: 200 }
      }))

      const { sendWebhook } = await import('@/lib/webhook')
      const client = { id: 'c1', name: 'Test', callbackUrl: 'https://example.com/hook/', webhookSecret: 'sec' }

      await sendWebhook(client, 'task.created', { ibsTaskId: 't1' })
      expect(capturedUrl).toBe('https://example.com/hook/task.created')
    })
  })

  describe('emitTaskUpdated — filtering + completedAt', () => {
    it('does NOT emit for tasks without externalRef', async () => {
      prismaMock.task.findUnique.mockResolvedValue({
        id: 'task-1', externalRef: null, externalSource: null,
        status: 'DONE', blocked: false, assignees: [],
        resultData: null, updatedAt: new Date(), deadline: null,
        completedAt: null,
      } as never)

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
        completedAt: null,
      } as never)

      vi.stubGlobal('fetch', vi.fn())

      const { emitTaskUpdated } = await import('@/lib/webhook')
      await emitTaskUpdated('task-1', 'OPEN')

      expect(fetch).not.toHaveBeenCalled()
    })

    it('includes completedAt in payload', async () => {
      const completedDate = new Date('2026-07-01T12:00:00Z')

      prismaMock.task.findUnique.mockResolvedValue({
        id: 'task-1', externalRef: 'SALE-001', externalSource: 'sale',
        status: 'DONE', blocked: false,
        assignees: [],
        resultData: { externalClientId: 'c1', briefing: {} },
        updatedAt: new Date(), deadline: null,
        completedAt: completedDate,
      } as never)

      prismaMock.user.findMany.mockResolvedValue([])
      prismaMock.apiClient.findFirst.mockResolvedValue({
        id: 'c1', name: 'Sale', callbackUrl: 'https://sale.example.com/webhooks/ibs',
        webhookSecret: 'sec', active: true,
      } as never)

      let capturedBody = ''
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        capturedBody = init.body as string
        return { ok: true, status: 200 }
      }))

      const { emitTaskUpdated } = await import('@/lib/webhook')
      await emitTaskUpdated('task-1', 'IN_PROGRESS')

      await new Promise(r => setTimeout(r, 50))

      const parsed = JSON.parse(capturedBody)
      expect(parsed.completedAt).toBe(completedDate.toISOString())
      expect(parsed.event).toBe('task.updated')
    })
  })

  describe('broadcastWebhook', () => {
    it('sends to all active clients with callbackUrl', async () => {
      prismaMock.apiClient.findMany.mockResolvedValue([
        { id: 'c1', name: 'Sale', callbackUrl: 'https://sale.example.com/hook', webhookSecret: 's1' },
        { id: 'c2', name: 'Other', callbackUrl: 'https://other.example.com/hook', webhookSecret: 's2' },
      ] as never)

      const urls: string[] = []
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
        urls.push(url)
        return { ok: true, status: 200 }
      }))

      const { broadcastWebhook } = await import('@/lib/webhook')
      await broadcastWebhook('departments.changed', { summary: 'test' })

      await new Promise(r => setTimeout(r, 50))
      expect(urls).toContain('https://sale.example.com/hook/departments.changed')
      expect(urls).toContain('https://other.example.com/hook/departments.changed')
    })
  })

  describe('emitProjectApproved', () => {
    it('broadcasts project.approved with externalRef/projectId/projectCode', async () => {
      prismaMock.projectSubmission.findUnique.mockResolvedValue({
        id: 'sub-1', externalRef: 'OPP-123', projectId: 'proj-1', projectCode: '26-TEST-001',
        status: 'APPROVED',
      } as never)

      prismaMock.apiClient.findMany.mockResolvedValue([
        { id: 'c1', name: 'Sale', callbackUrl: 'https://sale.example.com/hook', webhookSecret: 'sec' },
      ] as never)

      let capturedBody = ''
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        capturedBody = init.body as string
        return { ok: true, status: 200 }
      }))

      const { emitProjectApproved } = await import('@/lib/webhook')
      await emitProjectApproved('sub-1')

      await new Promise(r => setTimeout(r, 50))
      const parsed = JSON.parse(capturedBody)
      expect(parsed.event).toBe('project.approved')
      expect(parsed.externalRef).toBe('OPP-123')
      expect(parsed.projectId).toBe('proj-1')
      expect(parsed.projectCode).toBe('26-TEST-001')
    })
  })

  describe('emitProjectRejected', () => {
    it('broadcasts project.rejected with externalRef and reason', async () => {
      prismaMock.projectSubmission.findUnique.mockResolvedValue({
        id: 'sub-2', externalRef: 'OPP-456', reason: 'Không đủ năng lực',
        status: 'REJECTED',
      } as never)

      prismaMock.apiClient.findMany.mockResolvedValue([
        { id: 'c1', name: 'Sale', callbackUrl: 'https://sale.example.com/hook', webhookSecret: 'sec' },
      ] as never)

      let capturedBody = ''
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        capturedBody = init.body as string
        return { ok: true, status: 200 }
      }))

      const { emitProjectRejected } = await import('@/lib/webhook')
      await emitProjectRejected('sub-2')

      await new Promise(r => setTimeout(r, 50))
      const parsed = JSON.parse(capturedBody)
      expect(parsed.event).toBe('project.rejected')
      expect(parsed.externalRef).toBe('OPP-456')
      expect(parsed.reason).toBe('Không đủ năng lực')
    })
  })
})
