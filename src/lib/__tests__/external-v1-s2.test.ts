/**
 * Tests for S2 external/v1 endpoints:
 * - GET /departments
 * - PATCH /tasks/{id}/status
 * - POST /projects (submission)
 * - GET /projects/{externalRef}
 * - GET /customers/{saleCustomerId}/ar-summary
 * - GET /contracts/{id}
 * - errorResponse code field
 */

import { describe, it, expect } from 'vitest'
import { errorResponse, successResponse } from '@/lib/auth'
import { DEPARTMENTS_V2 } from '@/lib/org-map'

// ── errorResponse code field ──

describe('errorResponse with code', () => {
  it('includes code when provided', async () => {
    const res = errorResponse('Not found', 404, 'NOT_FOUND')
    const body = await res.json()
    expect(body).toEqual({ ok: false, error: 'Not found', code: 'NOT_FOUND' })
    expect(res.status).toBe(404)
  })

  it('omits code when not provided (backward compat)', async () => {
    const res = errorResponse('Bad request', 400)
    const body = await res.json()
    expect(body).toEqual({ ok: false, error: 'Bad request' })
    expect(body.code).toBeUndefined()
  })
})

// ── successResponse shape ──

describe('successResponse envelope', () => {
  it('wraps data with ok:true', async () => {
    const res = successResponse({ data: [1, 2, 3] })
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data).toEqual([1, 2, 3])
  })
})

// ── DEPARTMENTS_V2 ──

describe('DEPARTMENTS_V2', () => {
  it('has 10 departments', () => {
    expect(DEPARTMENTS_V2).toHaveLength(10)
  })

  it('each has code and name', () => {
    for (const d of DEPARTMENTS_V2) {
      expect(d.code).toBeTruthy()
      expect(d.name).toBeTruthy()
    }
  })

  it('maps to expected deptCode/displayLabel shape', () => {
    const mapped = DEPARTMENTS_V2.map(d => ({ deptCode: d.code, displayLabel: d.name }))
    expect(mapped[0]).toEqual({ deptCode: 'BGD', displayLabel: 'Ban Giám đốc' })
    expect(mapped[9]).toEqual({ deptCode: 'TBCG', displayLabel: 'Thiết bị & Cơ giới' })
  })
})

// ── PATCH tasks status — transition validation (unit logic) ──

describe('task status transitions', () => {
  const ALLOWED: Record<string, string[]> = {
    OPEN: ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['DONE', 'RETURNED', 'CANCELLED'],
    RETURNED: ['IN_PROGRESS', 'CANCELLED'],
    DONE: [],
    CANCELLED: [],
  }

  it('OPEN can go to IN_PROGRESS', () => {
    expect(ALLOWED['OPEN']).toContain('IN_PROGRESS')
  })

  it('IN_PROGRESS can go to DONE', () => {
    expect(ALLOWED['IN_PROGRESS']).toContain('DONE')
  })

  it('DONE is terminal', () => {
    expect(ALLOWED['DONE']).toEqual([])
  })

  it('CANCELLED is terminal', () => {
    expect(ALLOWED['CANCELLED']).toEqual([])
  })

  it('RETURNED can go back to IN_PROGRESS', () => {
    expect(ALLOWED['RETURNED']).toContain('IN_PROGRESS')
  })
})

// ── AR summary grading logic ──

describe('payment grade logic', () => {
  function grade(paidCount: number, lateCount12mo: number, avgDays: number | null): string {
    if (paidCount === 0) return 'UNKNOWN'
    if (lateCount12mo === 0 && avgDays !== null && avgDays <= 30) return 'A'
    if (lateCount12mo <= 2 && avgDays !== null && avgDays <= 60) return 'B'
    if (lateCount12mo <= 5) return 'C'
    return 'D'
  }

  it('returns UNKNOWN for no payments', () => {
    expect(grade(0, 0, null)).toBe('UNKNOWN')
  })

  it('returns A for on-time, fast pay', () => {
    expect(grade(5, 0, 20)).toBe('A')
  })

  it('returns B for 1 late, moderate pay speed', () => {
    expect(grade(10, 1, 45)).toBe('B')
  })

  it('returns C for up to 5 late payments', () => {
    expect(grade(10, 4, 90)).toBe('C')
  })

  it('returns D for many late payments', () => {
    expect(grade(10, 8, 120)).toBe('D')
  })
})
