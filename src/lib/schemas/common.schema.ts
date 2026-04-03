import { z } from 'zod'

// ── Pagination ──

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type PaginationInput = z.infer<typeof paginationSchema>

// ── ID param (cuid) ──

export const idParamSchema = z.object({
  id: z.string().min(1, 'ID is required'),
})

export type IdParam = z.infer<typeof idParamSchema>

// ── Date range filter ──

export const dateRangeSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
}).refine(
  (data) => {
    if (data.startDate && data.endDate) {
      return new Date(data.startDate) <= new Date(data.endDate)
    }
    return true
  },
  { message: 'startDate must be before or equal to endDate', path: ['endDate'] }
)

export type DateRangeInput = z.infer<typeof dateRangeSchema>

// ── Sort order ──

export const sortOrderSchema = z.enum(['asc', 'desc']).default('desc')

export type SortOrder = z.infer<typeof sortOrderSchema>

// ── Search + status filter (very common pattern) ──

export const searchFilterSchema = paginationSchema.extend({
  search: z.string().optional().default(''),
  status: z.string().optional(),
})

export type SearchFilterInput = z.infer<typeof searchFilterSchema>

// ── Coerce helpers for query params (strings from URL) ──

/** Coerce a string-or-undefined query param to optional string */
export const optionalString = z.string().optional()

/** Coerce a query param to optional number */
export const optionalNumber = z.coerce.number().optional()
