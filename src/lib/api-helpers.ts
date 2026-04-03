import { z } from 'zod'

type ZodSchema<T> = z.ZodType<T>
type ZodError = z.ZodError
import { errorResponse } from '@/lib/auth'

// ── Types ──

type ValidationSuccess<T> = { success: true; data: T }
type ValidationFailure = { success: false; response: ReturnType<typeof errorResponse> }
type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure

// ── Helpers ──

/**
 * Format Zod errors into a readable string with field paths.
 * Example: "username: Required; password: Minimum 6 characters"
 */
function formatZodErrors(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '_root'
      return `${path}: ${issue.message}`
    })
    .join('; ')
}

// ── Validation Functions ──

/**
 * Parse and validate request body with a Zod schema.
 *
 * On success: `{ success: true, data: T }`
 * On failure: `{ success: false, response: NextResponse }` (400 with structured error)
 *
 * Usage in route:
 * ```ts
 * const result = await validateBody(req, createProjectSchema)
 * if (!result.success) return result.response
 * const { projectCode, projectName } = result.data
 * ```
 */
export async function validateBody<T>(
  request: Request,
  schema: ZodSchema<T>,
): Promise<ValidationResult<T>> {
  try {
    const body = await request.json()
    const parsed = schema.safeParse(body)

    if (!parsed.success) {
      return {
        success: false,
        response: errorResponse(formatZodErrors(parsed.error), 400),
      }
    }

    return { success: true, data: parsed.data }
  } catch {
    return {
      success: false,
      response: errorResponse('Invalid JSON body', 400),
    }
  }
}

/**
 * Parse and validate URL search params with a Zod schema.
 *
 * Converts URLSearchParams to a plain object, then validates.
 * Handles coercion for pagination (page/limit as strings from URL).
 *
 * Usage:
 * ```ts
 * const result = validateQuery(req.url, projectListQuerySchema)
 * if (!result.success) return result.response
 * const { page, limit, search, status } = result.data
 * ```
 */
export function validateQuery<T>(
  url: URL | string,
  schema: ZodSchema<T>,
): ValidationResult<T> {
  const urlObj = typeof url === 'string' ? new URL(url) : url
  const params: Record<string, string> = {}

  urlObj.searchParams.forEach((value, key) => {
    params[key] = value
  })

  const parsed = schema.safeParse(params)

  if (!parsed.success) {
    return {
      success: false,
      response: errorResponse(formatZodErrors(parsed.error), 400),
    }
  }

  return { success: true, data: parsed.data }
}

/**
 * Parse and validate route params (e.g., `{ id: string }`) with a Zod schema.
 *
 * Usage:
 * ```ts
 * const result = validateParams(await params, idParamSchema)
 * if (!result.success) return result.response
 * const { id } = result.data
 * ```
 */
export function validateParams<T>(
  params: Record<string, string>,
  schema: ZodSchema<T>,
): ValidationResult<T> {
  const parsed = schema.safeParse(params)

  if (!parsed.success) {
    return {
      success: false,
      response: errorResponse(formatZodErrors(parsed.error), 400),
    }
  }

  return { success: true, data: parsed.data }
}

// Re-export for convenience
export { formatZodErrors }
