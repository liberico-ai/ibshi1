import { describe, it, expect } from 'vitest'
import { validateFileName, ALLOWED_EXTENSIONS, ENTITY_ID_REGEX } from '@/lib/save-attachment'

describe('save-attachment', () => {
  describe('validateFileName', () => {
    it('accepts allowed extensions', () => {
      for (const ext of ALLOWED_EXTENSIONS) {
        expect(validateFileName(`file${ext}`)).toBeNull()
      }
    })

    it('rejects .svg', () => {
      expect(validateFileName('evil.svg')).toContain('.svg')
    })

    it('rejects .html', () => {
      expect(validateFileName('page.html')).toContain('.html')
    })

    it('rejects .exe', () => {
      expect(validateFileName('trojan.exe')).toContain('.exe')
    })

    it('rejects file without extension', () => {
      expect(validateFileName('noext')).toContain('phần mở rộng')
    })
  })

  describe('ENTITY_ID_REGEX', () => {
    it('accepts valid entityIds', () => {
      expect(ENTITY_ID_REGEX.test('task-1_doc0')).toBe(true)
      expect(ENTITY_ID_REGEX.test('abc.def-123')).toBe(true)
    })

    it('rejects invalid entityIds', () => {
      expect(ENTITY_ID_REGEX.test('')).toBe(false)
      expect(ENTITY_ID_REGEX.test('a/b')).toBe(false)
      expect(ENTITY_ID_REGEX.test('../etc')).toBe(false)
      expect(ENTITY_ID_REGEX.test('a b')).toBe(false)
    })
  })
})
