import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { calculateSalary, type SalaryInput } from '@/lib/salary-engine'

// POST /api/hr/salary/calculate — Calculate salary for employee
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    if (!['R01', 'R02', 'R03', 'R08'].includes(user.roleCode)) {
      return errorResponse('Bạn không có quyền tính lương', 403)
    }

    const body = await req.json()
    const input: SalaryInput = {
      baseSalary: body.baseSalary || 0,
      overtimeHours: body.overtimeHours,
      overtimeRate: body.overtimeRate,
      pieceRateAmount: body.pieceRateAmount,
      allowances: body.allowances,
      dependents: body.dependents,
      workingDays: body.workingDays,
      standardDays: body.standardDays,
      advancePaid: body.advancePaid,
    }

    if (input.baseSalary <= 0) {
      return errorResponse('Lương cơ bản phải lớn hơn 0')
    }

    const result = calculateSalary(input)
    return successResponse({ salary: result })
  } catch (err) {
    console.error('POST /api/hr/salary/calculate error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
