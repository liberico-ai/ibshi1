/**
 * R2-2 — Gate cho 7 bước "mồ côi" trong WORKFLOW_RULES.
 *
 * 7 bước không có gate + không bị next của bước nào trỏ tới → engine coi là
 * entry và spawn ngay ngày 1 khi áp template. Gate-driven spawn
 * (work-engine chainNextTemplateTasks) đọc gateCodes nên chỉ cần khai gate
 * đúng là chúng tự mọc đúng thời điểm.
 *
 * Kèm test toàn vẹn đồ thị: mọi mã trong gate/next/rejectTo phải tồn tại
 * trong WORKFLOW_RULES — bắt lỗi gõ nhầm mã bước trong tương lai.
 */
import { describe, it, expect } from 'vitest'
import { WORKFLOW_RULES } from '../workflow-constants'

describe('WORKFLOW_RULES — gate cho 7 bước mồ côi (R2-2)', () => {
  const expectedGates: Record<string, string[]> = {
    'P4.3': ['P3.6'],
    'P4.5': ['P4.4'],
    'P5.1': ['P4.5'],
    'P5.1A': ['P4.5'],
    'P5.1.1': ['P4.5'],
    'P5.2': ['P4.5'],
    'P5.5': ['P5.4'],
  }

  it.each(Object.entries(expectedGates))('%s có gate %j', (code, gate) => {
    const rule = WORKFLOW_RULES[code]
    expect(rule, `WORKFLOW_RULES['${code}'] phải tồn tại`).toBeDefined()
    expect(rule.gate).toEqual(gate)
  })

  it('các gate có sẵn từ trước không bị đổi (P1.3, P2.4, P6.5)', () => {
    expect(WORKFLOW_RULES['P1.3'].gate).toEqual(['P1.2A', 'P1.2'])
    expect(WORKFLOW_RULES['P2.4'].gate).toEqual(['P2.1', 'P2.2', 'P2.3', 'P2.1A'])
    expect(WORKFLOW_RULES['P6.5'].gate).toEqual(['P6.1', 'P6.2', 'P6.3', 'P6.4'])
  })
})

describe('WORKFLOW_RULES — toàn vẹn đồ thị', () => {
  const codes = new Set(Object.keys(WORKFLOW_RULES))

  it('key của record trùng với field code của từng rule', () => {
    for (const [key, rule] of Object.entries(WORKFLOW_RULES)) {
      expect(rule.code, `key '${key}' phải khớp rule.code`).toBe(key)
    }
  })

  it('mọi mã trong next tồn tại trong WORKFLOW_RULES', () => {
    for (const [key, rule] of Object.entries(WORKFLOW_RULES)) {
      for (const n of rule.next) {
        expect(codes.has(n), `${key}.next trỏ tới '${n}' không tồn tại`).toBe(true)
      }
    }
  })

  it('mọi mã trong gate tồn tại trong WORKFLOW_RULES', () => {
    for (const [key, rule] of Object.entries(WORKFLOW_RULES)) {
      for (const g of rule.gate || []) {
        expect(codes.has(g), `${key}.gate yêu cầu '${g}' không tồn tại`).toBe(true)
      }
    }
  })

  it('mọi rejectTo tồn tại trong WORKFLOW_RULES', () => {
    for (const [key, rule] of Object.entries(WORKFLOW_RULES)) {
      if (rule.rejectTo) {
        expect(codes.has(rule.rejectTo), `${key}.rejectTo trỏ tới '${rule.rejectTo}' không tồn tại`).toBe(true)
      }
    }
  })

  it('không bước nào tự gate/next chính mình', () => {
    for (const [key, rule] of Object.entries(WORKFLOW_RULES)) {
      expect(rule.next.includes(key), `${key}.next chứa chính nó`).toBe(false)
      expect((rule.gate || []).includes(key), `${key}.gate chứa chính nó`).toBe(false)
    }
  })
})
