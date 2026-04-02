import { describe, it, expect } from 'vitest'
import { cn, formatCurrency, formatDate, getStatusColor, getStatusBg, getUrgencyLabel, getProgressColor } from '@/lib/utils'

describe('cn (classname merge)', () => {
  it('merges class names', () => {
    expect(cn('px-2', 'py-1')).toBe('px-2 py-1')
  })

  it('handles conflicting tailwind classes', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })

  it('handles falsy values', () => {
    expect(cn('px-2', false && 'py-1', undefined, null)).toBe('px-2')
  })
})

describe('formatCurrency', () => {
  it('formats VND by default', () => {
    expect(formatCurrency(1000000)).toBe('1,000,000 ₫')
  })

  it('returns dash for null/undefined', () => {
    expect(formatCurrency(null)).toBe('-')
    expect(formatCurrency(undefined)).toBe('-')
  })

  it('handles string input', () => {
    expect(formatCurrency('500000')).toBe('500,000 ₫')
  })

  it('formats USD when specified', () => {
    const result = formatCurrency(1000, 'USD')
    expect(result).toContain('1,000')
  })
})

describe('formatDate', () => {
  it('formats date in DD/MM/YYYY', () => {
    const result = formatDate('2026-03-15')
    expect(result).toBe('15/03/2026')
  })

  it('returns dash for null/undefined', () => {
    expect(formatDate(null)).toBe('-')
    expect(formatDate(undefined)).toBe('-')
  })

  it('handles Date object', () => {
    const result = formatDate(new Date('2026-01-01'))
    expect(result).toContain('2026')
  })
})

describe('getStatusColor', () => {
  it('returns correct colors for known statuses', () => {
    expect(getStatusColor('DONE')).toBe('text-emerald-600')
    expect(getStatusColor('IN_PROGRESS')).toBe('text-sky-600')
    expect(getStatusColor('PENDING')).toBe('text-slate-400')
    expect(getStatusColor('BLOCKED')).toBe('text-red-600')
    expect(getStatusColor('OVERDUE')).toBe('text-red-600')
    expect(getStatusColor('REJECTED')).toBe('text-red-600')
  })

  it('returns default for unknown status', () => {
    expect(getStatusColor('UNKNOWN')).toBe('text-slate-400')
  })
})

describe('getStatusBg', () => {
  it('returns correct background classes for known statuses', () => {
    expect(getStatusBg('DONE')).toContain('bg-emerald-50')
    expect(getStatusBg('IN_PROGRESS')).toContain('bg-sky-50')
    expect(getStatusBg('PENDING')).toContain('bg-slate-50')
    expect(getStatusBg('BLOCKED')).toContain('bg-red-50')
  })

  it('returns default for unknown status', () => {
    expect(getStatusBg('UNKNOWN')).toContain('bg-slate-50')
  })
})

describe('getUrgencyLabel', () => {
  it('returns correct labels', () => {
    expect(getUrgencyLabel('overdue')).toEqual({ label: 'Quá hạn', color: 'bg-red-100 text-red-700' })
    expect(getUrgencyLabel('today')).toEqual({ label: 'Hôm nay', color: 'bg-amber-100 text-amber-700' })
    expect(getUrgencyLabel('this_week')).toEqual({ label: 'Tuần này', color: 'bg-sky-100 text-sky-700' })
  })

  it('returns empty for unknown urgency', () => {
    expect(getUrgencyLabel('unknown')).toEqual({ label: '', color: '' })
  })
})

describe('getProgressColor', () => {
  it('returns emerald for >= 80%', () => {
    expect(getProgressColor(80)).toBe('bg-emerald-500')
    expect(getProgressColor(100)).toBe('bg-emerald-500')
  })

  it('returns teal for >= 50%', () => {
    expect(getProgressColor(50)).toBe('bg-teal-500')
    expect(getProgressColor(79)).toBe('bg-teal-500')
  })

  it('returns sky for >= 25%', () => {
    expect(getProgressColor(25)).toBe('bg-sky-500')
    expect(getProgressColor(49)).toBe('bg-sky-500')
  })

  it('returns slate for < 25%', () => {
    expect(getProgressColor(0)).toBe('bg-slate-300')
    expect(getProgressColor(24)).toBe('bg-slate-300')
  })
})
