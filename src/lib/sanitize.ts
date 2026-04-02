/**
 * Input sanitization utilities.
 * Strips HTML tags and trims whitespace to prevent XSS via stored payloads.
 */

const HTML_TAG_RE = /<\/?[^>]+(>|$)/g

/** Strip all HTML tags from a string and trim whitespace. */
export function sanitizeString(input: string): string {
  return input.replace(HTML_TAG_RE, '').trim()
}

/**
 * Recursively sanitize all string fields in an object.
 * Returns a shallow-cloned object with sanitized strings; non-string primitives
 * and other types are passed through unchanged.
 */
export function sanitizeObject<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj

  if (typeof obj === 'string') {
    return sanitizeString(obj) as unknown as T
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item)) as unknown as T
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = sanitizeObject(value)
    }
    return result as T
  }

  return obj
}
