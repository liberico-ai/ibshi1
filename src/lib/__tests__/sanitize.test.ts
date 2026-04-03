import { describe, it, expect } from 'vitest'
import { sanitizeString, sanitizeObject } from '@/lib/sanitize'

describe('sanitizeString', () => {
  it('strips HTML tags', () => {
    expect(sanitizeString('<b>bold</b>')).toBe('bold')
  })

  it('strips script tags', () => {
    expect(sanitizeString('<script>alert("xss")</script>')).toBe('alert("xss")')
  })

  it('strips nested tags', () => {
    expect(sanitizeString('<div><p>hello</p></div>')).toBe('hello')
  })

  it('trims whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello')
  })

  it('handles strings with no HTML', () => {
    expect(sanitizeString('plain text')).toBe('plain text')
  })

  it('handles empty string', () => {
    expect(sanitizeString('')).toBe('')
  })

  it('strips self-closing tags', () => {
    expect(sanitizeString('before<br/>after')).toBe('beforeafter')
  })

  it('strips tags with attributes', () => {
    expect(sanitizeString('<a href="http://evil.com">click</a>')).toBe('click')
  })

  it('strips incomplete tags', () => {
    expect(sanitizeString('text<div')).toBe('text')
  })
})

describe('sanitizeObject', () => {
  it('sanitizes string fields in an object', () => {
    const input = { name: '<b>Test</b>', age: 25 }
    const result = sanitizeObject(input)
    expect(result).toEqual({ name: 'Test', age: 25 })
  })

  it('recursively sanitizes nested objects', () => {
    const input = {
      user: {
        name: '<script>alert(1)</script>John',
        bio: '<p>Hello</p>',
      },
    }
    const result = sanitizeObject(input)
    expect(result).toEqual({
      user: {
        name: 'alert(1)John',
        bio: 'Hello',
      },
    })
  })

  it('sanitizes arrays of strings', () => {
    const input = ['<b>one</b>', '<i>two</i>', 'three']
    const result = sanitizeObject(input)
    expect(result).toEqual(['one', 'two', 'three'])
  })

  it('handles mixed arrays', () => {
    const input = [{ name: '<b>Test</b>' }, 42, '<script>bad</script>']
    const result = sanitizeObject(input)
    expect(result).toEqual([{ name: 'Test' }, 42, 'bad'])
  })

  it('returns null for null input', () => {
    expect(sanitizeObject(null)).toBeNull()
  })

  it('returns undefined for undefined input', () => {
    expect(sanitizeObject(undefined)).toBeUndefined()
  })

  it('passes through numbers unchanged', () => {
    expect(sanitizeObject(42)).toBe(42)
  })

  it('passes through booleans unchanged', () => {
    expect(sanitizeObject(true)).toBe(true)
  })
})
