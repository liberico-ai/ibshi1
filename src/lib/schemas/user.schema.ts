import { z } from 'zod'

// POST /api/users — Create user
export const createUserSchema = z.object({
  username: z.string().min(1, 'Username là bắt buộc'),
  password: z.string().min(6, 'Mật khẩu tối thiểu 6 ký tự'),
  fullName: z.string().min(1, 'Họ tên là bắt buộc'),
  roleCode: z.string().min(1, 'Vai trò là bắt buộc'),
  userLevel: z.number().int().min(1).max(3).optional(),
  email: z.string().email('Email không hợp lệ').optional().or(z.literal('')),
  departmentCode: z.string().optional(),
})

export type CreateUserInput = z.infer<typeof createUserSchema>

// PATCH /api/users/[id] — Update user
export const updateUserSchema = z.object({
  fullName: z.string().min(1).optional(),
  roleCode: z.string().min(1).optional(),
  userLevel: z.number().int().min(1).max(3).optional(),
  email: z.string().email().optional().or(z.literal('')),
  departmentCode: z.string().optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(6).optional(),
})

export type UpdateUserInput = z.infer<typeof updateUserSchema>
