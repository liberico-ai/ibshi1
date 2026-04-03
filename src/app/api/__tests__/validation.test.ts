/**
 * Zod validation edge-case tests.
 *
 * Focuses on the shared validation utilities (validateBody, validateQuery)
 * and coercion behaviour — tested directly without needing to invoke
 * a full route handler.
 */
import { describe, it, expect, vi } from 'vitest'
import { validateBody, validateQuery } from '@/lib/api-helpers'
import { z } from 'zod'
import {
  loginSchema,
  createProjectSchema,
  stockMovementSchema,
  projectListQuerySchema,
} from '@/lib/schemas'

// Silence errorResponse's NextResponse usage in tests (no Next.js runtime here).
// The helpers only need @/lib/auth for errorResponse, which returns a NextResponse.
// Since we are in a node env, NextResponse is polyfilled by next/server — that's fine.

// ── validateBody ──────────────────────────────────────────────────────────────

describe('validateBody — loginSchema', () => {
  it('accepts valid username + password', async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'secret' }),
    })
    const result = await validateBody(req, loginSchema)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.username).toBe('admin')
      expect(result.data.password).toBe('secret')
    }
  })

  it('fails when username is empty string', async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '', password: 'secret' }),
    })
    const result = await validateBody(req, loginSchema)
    expect(result.success).toBe(false)
    if (!result.success) {
      const json = await result.response.json()
      expect(json.error).toContain('username')
    }
  })

  it('fails when body is invalid JSON', async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad json',
    })
    const result = await validateBody(req, loginSchema)
    expect(result.success).toBe(false)
    if (!result.success) {
      const json = await result.response.json()
      expect(json.ok).toBe(false)
    }
  })
})

describe('validateBody — createProjectSchema', () => {
  it('accepts minimal valid project', async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectCode: 'P-001',
        projectName: 'Test Project',
        clientName: 'Test Client',
        productType: 'Steel',
      }),
    })
    const result = await validateBody(req, createProjectSchema)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.currency).toBe('VND') // default applied
    }
  })

  it('includes field paths in error message for multiple missing fields', async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectCode: 'P-001' }),
    })
    const result = await validateBody(req, createProjectSchema)
    expect(result.success).toBe(false)
    if (!result.success) {
      const json = await result.response.json()
      // Should mention at least one of the missing required fields
      expect(json.error).toMatch(/projectName|clientName|productType/)
    }
  })

  it('accepts contractValue as string (union type)', async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectCode: 'P-002',
        projectName: 'Test',
        clientName: 'Client',
        productType: 'Steel',
        contractValue: '500000',
      }),
    })
    const result = await validateBody(req, createProjectSchema)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.contractValue).toBe('500000')
    }
  })
})

describe('validateBody — stockMovementSchema', () => {
  it('accepts valid IN movement', async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ materialId: 'mat-1', type: 'IN', quantity: 100, reason: 'Nhập hàng' }),
    })
    const result = await validateBody(req, stockMovementSchema)
    expect(result.success).toBe(true)
  })

  it('fails when type is not a valid enum value', async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ materialId: 'mat-1', type: 'INVALID', quantity: 100, reason: 'Test' }),
    })
    const result = await validateBody(req, stockMovementSchema)
    expect(result.success).toBe(false)
    if (!result.success) {
      const json = await result.response.json()
      expect(json.error).toContain('type')
    }
  })

  it('fails when quantity is zero', async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ materialId: 'mat-1', type: 'IN', quantity: 0, reason: 'Test' }),
    })
    const result = await validateBody(req, stockMovementSchema)
    expect(result.success).toBe(false)
    if (!result.success) {
      const json = await result.response.json()
      expect(json.error).toContain('quantity')
    }
  })
})

// ── validateQuery ─────────────────────────────────────────────────────────────

describe('validateQuery — projectListQuerySchema (coercion)', () => {
  it('coerces page string "10" to number 10', () => {
    const result = validateQuery('http://localhost/api/projects?page=10&limit=5', projectListQuerySchema)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.page).toBe(10)
      expect(result.data.limit).toBe(5)
    }
  })

  it('applies default page=1 and limit=20 when not provided', () => {
    const result = validateQuery('http://localhost/api/projects', projectListQuerySchema)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.page).toBe(1)
      expect(result.data.limit).toBe(20)
    }
  })

  it('fails when page is not numeric', () => {
    const result = validateQuery('http://localhost/api/projects?page=abc', projectListQuerySchema)
    expect(result.success).toBe(false)
    if (!result.success) {
      const json = result.response.json() // sync NextResponse.json() in node env
      // Just confirm we got a failure response
      expect(result.response.status).toBe(400)
    }
  })

  it('rejects limit > 100', () => {
    const result = validateQuery('http://localhost/api/projects?limit=200', projectListQuerySchema)
    expect(result.success).toBe(false)
    expect(result.response.status).toBe(400)
  })

  it('passes optional status filter through', () => {
    const result = validateQuery('http://localhost/api/projects?status=ACTIVE', projectListQuerySchema)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.status).toBe('ACTIVE')
    }
  })
})
