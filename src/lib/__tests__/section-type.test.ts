import { describe, it, expect } from 'vitest'
import { detectSectionType, normalizeDims, dimsMatch } from '../section-type'

// ══════════════════════════════════════════════════════════════
// detectSectionType
// ══════════════════════════════════════════════════════════════

describe('detectSectionType', () => {
  // ── PLATE ──
  it.each([
    ['PL10x2000x12000', 'PLATE'],
    ['PL8', 'PLATE'],
    ['PLATE 10mm', 'PLATE'],
    ['Thép tấm 10x2000x12000', 'PLATE'],
    ['Tôn tấm 6x1500x6000', 'PLATE'],
    ['Tôn 8mm', 'PLATE'],
    ['tấm thép', 'PLATE'],
  ])('PLATE: %s → %s', (input, expected) => {
    expect(detectSectionType(input)).toBe(expected)
  })

  // ── CHANNEL ──
  it.each([
    ['C100X50X5X7.5-12000L', 'CHANNEL'],
    ['C200', 'CHANNEL'],
    ['U200x75x7x6m', 'CHANNEL'],
    ['UPN200', 'CHANNEL'],
    ['UPE100', 'CHANNEL'],
    ['UNC150', 'CHANNEL'],
    ['CHANNEL 200', 'CHANNEL'],
    ['Thép U 200x75x7', 'CHANNEL'],
    ['Thép C 100x50', 'CHANNEL'],
    ['Thép hình U 200', 'CHANNEL'],
    ['Thép hình C300', 'CHANNEL'],
  ])('CHANNEL: %s → %s', (input, expected) => {
    expect(detectSectionType(input)).toBe(expected)
  })

  // ── HBEAM ──
  it.each([
    ['H252x203x8x13.5', 'HBEAM'],
    ['H300', 'HBEAM'],
    ['I200', 'HBEAM'],
    ['HEA300', 'HBEAM'],
    ['HEB200', 'HBEAM'],
    ['HEM400', 'HBEAM'],
    ['IPE200', 'HBEAM'],
    ['Thép H 252x203x8x13.5', 'HBEAM'],
    ['Thép I 200', 'HBEAM'],
    ['Thép hình H200', 'HBEAM'],
  ])('HBEAM: %s → %s', (input, expected) => {
    expect(detectSectionType(input)).toBe(expected)
  })

  // ── ANGLE ──
  it.each([
    ['L75x75x6', 'ANGLE'],
    ['L100x100x10', 'ANGLE'],
    ['V50x50x5', 'ANGLE'],
    ['EA 75x75x6', 'ANGLE'],
    ['UA 100x100', 'ANGLE'],
    ['Thép góc L75x75x6', 'ANGLE'],
    ['Thép hình góc 75x75', 'ANGLE'],
    ['Thép L 75x75x6', 'ANGLE'],
  ])('ANGLE: %s → %s', (input, expected) => {
    expect(detectSectionType(input)).toBe(expected)
  })

  // ── PIPE ──
  it.each([
    ['CHS Ø73', 'PIPE'],
    ['CHS 73x5.16', 'PIPE'],
    ['PIPE Ø60.3', 'PIPE'],
    ['Ø73x5', 'PIPE'],
    ['Thép ống 73x5.16', 'PIPE'],
    ['Thép hình ống Ø114', 'PIPE'],
  ])('PIPE: %s → %s', (input, expected) => {
    expect(detectSectionType(input)).toBe(expected)
  })

  // ── ROUND ──
  it.each([
    ['RB16', 'ROUND'],
    ['RB 20', 'ROUND'],
    ['D16', 'ROUND'],
    ['Thép tròn D16', 'ROUND'],
    ['Thép cây 12', 'ROUND'],
    ['Thép câ 10', 'ROUND'],
  ])('ROUND: %s → %s', (input, expected) => {
    expect(detectSectionType(input)).toBe(expected)
  })

  // ── BOX ──
  it.each([
    ['SHS100x100x4', 'BOX'],
    ['SHS 50x50x3', 'BOX'],
    ['RHS150x100x5', 'BOX'],
    ['RHS 200x100x6', 'BOX'],
    ['Thép hộp 100x100x4', 'BOX'],
    ['Thép hình hộp 150x100x5', 'BOX'],
  ])('BOX: %s → %s', (input, expected) => {
    expect(detectSectionType(input)).toBe(expected)
  })

  // ── null (no match) ──
  it.each([
    ['Bu lông M16x50'],
    ['Sơn chống rỉ'],
    ['Que hàn 3.2mm'],
    [''],
  ])('null: %s', (input) => {
    expect(detectSectionType(input)).toBeNull()
  })

  // ── Priority: specific beats generic ──
  it('THÉP HỘP wins over THÉP H', () => {
    expect(detectSectionType('Thép hộp 100x100x4')).toBe('BOX')
  })
  it('THÉP ỐNG wins over Ø', () => {
    expect(detectSectionType('Thép ống Ø73')).toBe('PIPE')
  })
  it('TÔN TẤM wins over TẤM', () => {
    expect(detectSectionType('Tôn tấm 6mm')).toBe('PLATE')
  })
})

// ══════════════════════════════════════════════════════════════
// normalizeDims
// ══════════════════════════════════════════════════════════════

describe('normalizeDims', () => {
  // ── Profile codes (Thiết kế) ──
  it.each([
    ['PL10x2000x12000', '10x2000x12000'],
    ['PL8', '8'],
    ['C100X50X5X7.5-12000L', '100x50x5x7.5'],
    ['U200x75x7x6m', '200x75x7x6000'],
    ['H252x203x8x13.5', '252x203x8x13.5'],
    ['L75x75x6', '75x75x6'],
    ['V50x50x5', '50x50x5'],
    ['SHS100x100x4', '100x100x4'],
    ['RHS150x100x5', '150x100x5'],
    ['CHS Ø73', '73'],
    ['RB16', '16'],
    ['D20', '20'],
    ['Ø73x5.16', '73x5.16'],
    ['IPE200', '200'],
    ['HEA300', '300'],
  ])('profile: %s → %s', (input, expected) => {
    expect(normalizeDims(input)).toBe(expected)
  })

  // ── Inventory names (Kho) ──
  it.each([
    ['Thép tấm 10x2000x12000', '10x2000x12000'],
    ['Thép U 200x75x7', '200x75x7'],
    ['Thép H 252x203x8x13.5', '252x203x8x13.5'],
    ['Thép góc 75x75x6', '75x75x6'],
    ['Thép ống 73x5.16', '73x5.16'],
    ['Thép tròn 16', '16'],
    ['Thép hộp 100x100x4', '100x100x4'],
    ['Thép hình H 300x150x6.5x9', '300x150x6.5x9'],
    ['Tôn tấm 8x1500x6000', '8x1500x6000'],
    ['Thép hình C 100x50x5x7.5', '100x50x5x7.5'],
  ])('inventory: %s → %s', (input, expected) => {
    expect(normalizeDims(input)).toBe(expected)
  })

  // ── Separator normalization ──
  it('normalizes × separator', () => {
    expect(normalizeDims('10×2000×12000')).toBe('10x2000x12000')
  })
  it('normalizes * separator', () => {
    expect(normalizeDims('10*2000*12000')).toBe('10x2000x12000')
  })
  it('normalizes mixed separators', () => {
    expect(normalizeDims('PL10 x 2000 × 12000')).toBe('10x2000x12000')
  })

  // ── Length suffix stripping ──
  it('strips -12000L suffix', () => {
    expect(normalizeDims('C100x50-12000L')).toBe('100x50')
  })
  it('strips -6m suffix', () => {
    expect(normalizeDims('C100x50-6m')).toBe('100x50')
  })
  it('strips -6000 suffix', () => {
    expect(normalizeDims('C100x50-6000')).toBe('100x50')
  })

  // ── Meter → mm conversion ──
  it('converts trailing 6m to 6000', () => {
    expect(normalizeDims('U200x75x7x6m')).toBe('200x75x7x6000')
  })

  // ── mm removal ──
  it('removes mm suffix', () => {
    expect(normalizeDims('PL10mm')).toBe('10')
  })

  // ── Empty / no dims ──
  it('returns empty for empty input', () => {
    expect(normalizeDims('')).toBe('')
  })
  it('returns empty for non-dimension text', () => {
    expect(normalizeDims('Bu lông')).toBe('')
  })
})

// ══════════════════════════════════════════════════════════════
// dimsMatch
// ══════════════════════════════════════════════════════════════

describe('dimsMatch', () => {
  it('exact match', () => {
    expect(dimsMatch('10x2000x12000', '10x2000x12000')).toBe(true)
  })

  it('prefix match — PR has fewer dims', () => {
    expect(dimsMatch('73', '73x5.16')).toBe(true)
  })

  it('prefix match — inventory has fewer dims', () => {
    expect(dimsMatch('100x50x5x7.5', '100x50x5')).toBe(true)
  })

  it('no match — different first dim', () => {
    expect(dimsMatch('10', '12x2000x12000')).toBe(false)
  })

  it('no match — 10 should not match 100', () => {
    expect(dimsMatch('10', '100x50')).toBe(false)
  })

  it('no match — second dim differs', () => {
    expect(dimsMatch('100x50', '100x75')).toBe(false)
  })

  it('decimal precision', () => {
    expect(dimsMatch('7.5', '7.5')).toBe(true)
    expect(dimsMatch('7.5', '7.6')).toBe(false)
  })

  it('empty strings', () => {
    expect(dimsMatch('', '100')).toBe(false)
    expect(dimsMatch('100', '')).toBe(false)
  })
})

// ══════════════════════════════════════════════════════════════
// Cross-matching: PR profile ↔ Inventory name (integration)
// ══════════════════════════════════════════════════════════════

describe('cross-matching PR ↔ Inventory', () => {
  function crossMatch(prProfile: string, prDesc: string, invName: string, invSpec?: string) {
    const prSection = detectSectionType(`${prProfile} ${prDesc}`)
    const invSection = detectSectionType(`${invName} ${invSpec || ''}`)
    if (!prSection || !invSection || prSection !== invSection) return false
    const prDims = normalizeDims(prProfile)
    const invDims = normalizeDims(invSpec || invName)
    return dimsMatch(prDims, invDims)
  }

  it('PL10x2000x12000 ~ Thép tấm 10x2000x12000', () => {
    expect(crossMatch('PL10x2000x12000', 'THÉP TẤM', 'Thép tấm 10x2000x12000')).toBe(true)
  })

  it('C100X50X5X7.5-12000L ~ Thép U 100x50x5x7.5', () => {
    expect(crossMatch('C100X50X5X7.5-12000L', 'THÉP HÌNH C', 'Thép U 100x50x5x7.5', '100x50x5x7.5')).toBe(true)
  })

  it('U200x75x7x6m ~ Thép U 200x75x7', () => {
    expect(crossMatch('U200x75x7x6m', 'THÉP U', 'Thép U 200x75x7', '200x75x7')).toBe(true)
  })

  it('CHS Ø73 ~ Thép ống 73x5.16', () => {
    expect(crossMatch('CHS Ø73', 'THÉP ỐNG', 'Thép ống 73x5.16', '73x5.16')).toBe(true)
  })

  it('H252x203x8x13.5 ~ Thép H 252x203x8x13.5', () => {
    expect(crossMatch('H252x203x8x13.5', 'THÉP HÌNH H', 'Thép H 252x203x8x13.5', '252x203x8x13.5')).toBe(true)
  })

  it('L75x75x6 ~ Thép góc 75x75x6', () => {
    expect(crossMatch('L75x75x6', 'THÉP GÓC', 'Thép góc 75x75x6', '75x75x6')).toBe(true)
  })

  it('SHS100x100x4 ~ Thép hộp 100x100x4', () => {
    expect(crossMatch('SHS100x100x4', '', 'Thép hộp 100x100x4', '100x100x4')).toBe(true)
  })

  it('RHS150x100x5 ~ Thép hộp 150x100x5', () => {
    expect(crossMatch('RHS150x100x5', '', 'Thép hộp 150x100x5', '150x100x5')).toBe(true)
  })

  it('RB16 ~ Thép tròn 16', () => {
    expect(crossMatch('RB16', 'THÉP TRÒN', 'Thép tròn 16', '16')).toBe(true)
  })

  it('no match: different section type', () => {
    expect(crossMatch('PL10', 'THÉP TẤM', 'Thép ống 10x3')).toBe(false)
  })

  it('no match: different dims', () => {
    expect(crossMatch('H300x150', 'THÉP H', 'Thép H 252x203x8x13.5', '252x203x8x13.5')).toBe(false)
  })

  it('BOX: SHS (vuông) does NOT match RHS (chữ nhật)', () => {
    expect(crossMatch('SHS100x100x4', '', 'Thép hộp 150x100x5', '150x100x5')).toBe(false)
  })
})
