import { z } from 'zod'
import { searchFilterSchema } from './common.schema'

// GET /api/projects — query params
export const projectListQuerySchema = searchFilterSchema.extend({
  status: z.string().optional(),
})

export type ProjectListQuery = z.infer<typeof projectListQuerySchema>

// POST /api/projects — Create project
export const createProjectSchema = z.object({
  projectCode: z.string().min(1, 'Mã dự án là bắt buộc'),
  projectName: z.string().min(1, 'Tên dự án là bắt buộc'),
  clientName: z.string().min(1, 'Tên khách hàng là bắt buộc'),
  productType: z.string().min(1, 'Loại sản phẩm là bắt buộc'),
  contractValue: z.union([z.string(), z.number()]).optional(),
  currency: z.string().default('VND'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  description: z.string().optional(),
  draftId: z.string().optional(),
})

export type CreateProjectInput = z.infer<typeof createProjectSchema>

// PATCH /api/projects/[id] — Update project
export const updateProjectSchema = z.object({
  projectName: z.string().min(1).optional(),
  clientName: z.string().min(1).optional(),
  productType: z.string().min(1).optional(),
  contractValue: z.union([z.string(), z.number()]).optional(),
  currency: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  description: z.string().optional(),
  status: z.string().optional(),
})

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>
