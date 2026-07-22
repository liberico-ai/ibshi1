import { describe, it, expect } from 'vitest'
import { isResolved } from '../utils'

// Revise Flow36 · Phase 0 — helper gate/tiến độ.
// Phase 0 behavior-identical: chưa dữ liệu nào có SKIPPED_NO_IMPACT → isResolved ≡ (=== 'DONE').
describe('isResolved', () => {
  it('DONE → true', () => {
    expect(isResolved('DONE')).toBe(true)
  })
  it('SKIPPED_NO_IMPACT → true (dùng ở Phase 1)', () => {
    expect(isResolved('SKIPPED_NO_IMPACT')).toBe(true)
  })
  it('OPEN / IN_PROGRESS / RETURNED / CANCELLED / AWAITING_REVIEW → false', () => {
    for (const s of ['OPEN', 'IN_PROGRESS', 'RETURNED', 'CANCELLED', 'AWAITING_REVIEW']) {
      expect(isResolved(s)).toBe(false)
    }
  })
  it('chuỗi lạ → false', () => {
    expect(isResolved('')).toBe(false)
    expect(isResolved('done')).toBe(false) // case-sensitive
  })
})
