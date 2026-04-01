import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/hr/salary — monthly salary records
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const month = Number(searchParams.get('month')) || new Date().getMonth() + 1
    const year = Number(searchParams.get('year')) || new Date().getFullYear()
    const status = searchParams.get('status') || ''

    const where: Record<string, unknown> = { month, year }
    if (status) where.status = status

    const records = await prisma.salaryRecord.findMany({
      where: where as never,
      include: { employee: { select: { employeeCode: true, fullName: true, departmentId: true } } },
      orderBy: { employee: { fullName: 'asc' } },
    })

    // Totals
    const totals = records.reduce((acc, r) => ({
      grossPay: acc.grossPay + Number(r.baseSalary) + Number(r.allowances) + Number(r.overtimePay) + Number(r.bonus),
      deductions: acc.deductions + Number(r.socialInsurance) + Number(r.healthInsurance) + Number(r.unemploymentIns) + Number(r.personalTax) + Number(r.deductions),
      netPay: acc.netPay + Number(r.netSalary),
      count: acc.count + 1,
    }), { grossPay: 0, deductions: 0, netPay: 0, count: 0 })

    return successResponse({ records, totals, month, year })
  } catch (err) {
    console.error('GET /api/hr/salary error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/hr/salary/calculate — calculate salary for all active employees in a month
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!['R01', 'R02'].includes(user.roleCode)) {
      return NextResponse.json({ ok: false, error: 'Không có quyền' }, { status: 403 })
    }

    const body = await req.json()
    const month = Number(body.month) || new Date().getMonth() + 1
    const year = Number(body.year) || new Date().getFullYear()

    // Get active employees with contracts
    const employees = await prisma.employee.findMany({
      where: { status: 'ACTIVE' },
      include: { contracts: { where: { status: 'ACTIVE' }, take: 1 } },
    })

    const startDate = new Date(year, month - 1, 1)
    const endDate = new Date(year, month, 0)
    const results = []

    for (const emp of employees) {
      const contract = emp.contracts[0]
      if (!contract) continue

      // Get attendance for month
      const attendance = await prisma.attendance.findMany({
        where: { employeeId: emp.id, date: { gte: startDate, lte: endDate } },
      })

      const actualDays = attendance.filter(a => a.status === 'PRESENT' || a.status === 'LATE').length
        + attendance.filter(a => a.status === 'HALF_DAY').length * 0.5
      const overtimeHours = attendance.reduce((sum, a) => sum + Number(a.overtime || 0), 0)

      const baseSalary = Number(contract.baseSalary)
      const dailyRate = baseSalary / contract.workDays
      const proRataSalary = dailyRate * actualDays
      const overtimePay = (dailyRate / 8) * 1.5 * overtimeHours
      const allowances = Number(contract.allowances)

      // BHXH: 8% * base (cap 36M), BHYT: 1.5%, BHTN: 1%
      const insuranceBase = Math.min(baseSalary, 36000000)
      const socialInsurance = insuranceBase * 0.08
      const healthInsurance = insuranceBase * 0.015
      const unemploymentIns = insuranceBase * 0.01

      // Taxable income = gross - insurance - 11M personal deduction
      const grossIncome = proRataSalary + overtimePay + allowances
      const taxableIncome = Math.max(0, grossIncome - socialInsurance - healthInsurance - unemploymentIns - 11000000)

      // Vietnam progressive tax (simplified)
      let personalTax = 0
      if (taxableIncome > 0) {
        if (taxableIncome <= 5000000) personalTax = taxableIncome * 0.05
        else if (taxableIncome <= 10000000) personalTax = 250000 + (taxableIncome - 5000000) * 0.10
        else if (taxableIncome <= 18000000) personalTax = 750000 + (taxableIncome - 10000000) * 0.15
        else if (taxableIncome <= 32000000) personalTax = 1950000 + (taxableIncome - 18000000) * 0.20
        else if (taxableIncome <= 52000000) personalTax = 4750000 + (taxableIncome - 32000000) * 0.25
        else if (taxableIncome <= 80000000) personalTax = 9750000 + (taxableIncome - 52000000) * 0.30
        else personalTax = 18150000 + (taxableIncome - 80000000) * 0.35
      }

      const netSalary = grossIncome - socialInsurance - healthInsurance - unemploymentIns - personalTax

      const record = await prisma.salaryRecord.upsert({
        where: { employeeId_month_year: { employeeId: emp.id, month, year } },
        update: {
          baseSalary: proRataSalary,
          workDays: contract.workDays,
          actualDays,
          overtimeHours,
          overtimePay,
          allowances,
          socialInsurance,
          healthInsurance,
          unemploymentIns,
          taxableIncome,
          personalTax,
          netSalary,
          status: 'CALCULATED',
          calculatedAt: new Date(),
        },
        create: {
          employeeId: emp.id,
          month,
          year,
          baseSalary: proRataSalary,
          workDays: contract.workDays,
          actualDays,
          overtimeHours,
          overtimePay,
          allowances,
          socialInsurance,
          healthInsurance,
          unemploymentIns,
          taxableIncome,
          personalTax,
          netSalary,
          status: 'CALCULATED',
          calculatedAt: new Date(),
        },
      })
      results.push(record)
    }

    return successResponse({ ok: true, calculated: results.length, month, year })
  } catch (err) {
    console.error('POST /api/hr/salary error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
