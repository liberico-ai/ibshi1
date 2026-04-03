import { z } from 'zod'
import { searchFilterSchema } from './common.schema'

// ── Employee ──

export const employeeListQuerySchema = searchFilterSchema.extend({
  department: z.string().optional(),
})

export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>

export const createEmployeeSchema = z.object({
  employeeCode: z.string().min(1, 'Mã nhân viên là bắt buộc'),
  fullName: z.string().min(1, 'Họ tên là bắt buộc'),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  departmentId: z.string().optional(),
  position: z.string().optional(),
  employmentType: z.enum(['FULL_TIME', 'CONTRACT', 'PROBATION']).default('FULL_TIME'),
  joinDate: z.string().optional(),
  dateOfBirth: z.string().optional(),
  gender: z.string().optional(),
  address: z.string().optional(),
  idNumber: z.string().optional(),
  taxCode: z.string().optional(),
  socialInsNo: z.string().optional(),
  bankAccount: z.string().optional(),
  bankName: z.string().optional(),
  dependents: z.number().int().min(0).default(0),
  distanceKm: z.number().int().min(0).default(0),
})

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>

export const updateEmployeeSchema = z.object({
  fullName: z.string().min(1).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  departmentId: z.string().optional(),
  position: z.string().optional(),
  employmentType: z.enum(['FULL_TIME', 'CONTRACT', 'PROBATION']).optional(),
  status: z.enum(['ACTIVE', 'ON_LEAVE', 'RESIGNED']).optional(),
  leaveDate: z.string().optional(),
  dateOfBirth: z.string().optional(),
  gender: z.string().optional(),
  address: z.string().optional(),
  idNumber: z.string().optional(),
  taxCode: z.string().optional(),
  socialInsNo: z.string().optional(),
  bankAccount: z.string().optional(),
  bankName: z.string().optional(),
  dependents: z.number().int().min(0).optional(),
  distanceKm: z.number().int().min(0).optional(),
})

export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>

// ── Attendance ──

export const recordAttendanceSchema = z.object({
  employeeId: z.string().min(1, 'Nhân viên là bắt buộc'),
  date: z.string().min(1, 'Ngày là bắt buộc'),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  hoursWorked: z.number().min(0).optional(),
  overtime: z.number().min(0).default(0),
  status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE']).default('PRESENT'),
  leaveType: z.string().optional(),
  notes: z.string().optional(),
})

export type RecordAttendanceInput = z.infer<typeof recordAttendanceSchema>

// Bulk attendance
export const bulkAttendanceSchema = z.object({
  date: z.string().min(1, 'Ngày là bắt buộc'),
  records: z.array(z.object({
    employeeId: z.string().min(1),
    status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE']).default('PRESENT'),
    hoursWorked: z.number().min(0).optional(),
    overtime: z.number().min(0).optional(),
    leaveType: z.string().optional(),
    notes: z.string().optional(),
  })).min(1, 'Cần ít nhất 1 bản ghi'),
})

export type BulkAttendanceInput = z.infer<typeof bulkAttendanceSchema>

// ── Salary Calculation ──

export const salaryCalcSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2100),
  employeeIds: z.array(z.string()).optional(),
})

export type SalaryCalcInput = z.infer<typeof salaryCalcSchema>

// ── Employee Contract ──

export const createContractSchema = z.object({
  employeeId: z.string().min(1, 'Nhân viên là bắt buộc'),
  contractType: z.string().min(1, 'Loại hợp đồng là bắt buộc'),
  startDate: z.string().min(1, 'Ngày bắt đầu là bắt buộc'),
  endDate: z.string().optional(),
  baseSalary: z.number().positive('Lương cơ bản phải > 0'),
  allowances: z.number().min(0).default(0),
  currency: z.string().default('VND'),
  workDays: z.number().int().min(1).max(31).default(26),
  notes: z.string().optional(),
})

export type CreateContractInput = z.infer<typeof createContractSchema>

export const updateContractSchema = z.object({
  contractType: z.string().optional(),
  endDate: z.string().optional(),
  baseSalary: z.number().positive().optional(),
  allowances: z.number().min(0).optional(),
  workDays: z.number().int().min(1).max(31).optional(),
  status: z.enum(['ACTIVE', 'EXPIRED', 'TERMINATED']).optional(),
  notes: z.string().optional(),
})

export type UpdateContractInput = z.infer<typeof updateContractSchema>

// ── Piece-Rate Contract ──

export const createPieceRateContractSchema = z.object({
  projectId: z.string().min(1, 'Dự án là bắt buộc'),
  teamCode: z.string().min(1, 'Mã tổ là bắt buộc'),
  workType: z.string().min(1, 'Loại công việc là bắt buộc'),
  unitPrice: z.number().positive('Đơn giá phải > 0'),
  unit: z.string().default('kg'),
  contractValue: z.number().positive().optional(),
  startDate: z.string().min(1, 'Ngày bắt đầu là bắt buộc'),
  endDate: z.string().optional(),
})

export type CreatePieceRateContractInput = z.infer<typeof createPieceRateContractSchema>

// ── Monthly Piece-Rate Output ──

export const createPieceRateOutputSchema = z.object({
  contractId: z.string().min(1, 'Hợp đồng khoán là bắt buộc'),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2100),
  quantity: z.number().positive('Sản lượng phải > 0'),
  unitPrice: z.number().positive('Đơn giá phải > 0'),
  notes: z.string().optional(),
})

export type CreatePieceRateOutputInput = z.infer<typeof createPieceRateOutputSchema>

// ── Timesheet ──

export const createTimesheetSchema = z.object({
  employeeId: z.string().min(1, 'Nhân viên là bắt buộc'),
  projectId: z.string().min(1, 'Dự án là bắt buộc'),
  workDate: z.string().min(1, 'Ngày làm việc là bắt buộc'),
  hoursRegular: z.number().min(0).default(8),
  hoursOT: z.number().min(0).default(0),
  taskDescription: z.string().optional(),
})

export type CreateTimesheetInput = z.infer<typeof createTimesheetSchema>
