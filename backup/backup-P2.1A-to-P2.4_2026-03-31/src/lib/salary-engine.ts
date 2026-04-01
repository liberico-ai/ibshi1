import prisma from './db'
import {
  calculateInsurance,
  calculateTax,
  calculateDeduction,
  ALLOWANCES,
  WORKING_DAYS,
} from './salary-config'

// ══════════════════════════════════════════════════════
//  SALARY ENGINE — BRD §3
//  Monthly salary calculation: gross → BHXH → tax → net
// ══════════════════════════════════════════════════════

export interface SalaryBreakdown {
  employeeId: string
  employeeName: string
  month: number
  year: number

  baseSalary: number
  actualDays: number
  standardDays: number
  proRatedBase: number
  overtimeHours: number
  overtimeAmount: number
  pieceRateAmount: number
  fuelAllowance: number
  mealAllowance: number
  otherAllowance: number
  totalAllowances: number
  grossSalary: number

  insurance: {
    employee: { bhxh: number; bhyt: number; bhtn: number; total: number }
    employer: { bhxh: number; bhyt: number; bhtn: number; total: number }
    salaryBase: number
  }

  taxableIncome: number
  deduction: { self: number; dependent: number; total: number }
  taxAmount: number
  taxBracket: number
  effectiveRate: number

  netSalary: number
  totalCostToCompany: number
}

// Backward-compatible export for existing API
export interface SalaryInput {
  baseSalary: number
  overtimeHours?: number
  overtimeRate?: number
  pieceRateAmount?: number
  allowances?: number
  dependents?: number
  workingDays?: number
  standardDays?: number
  advancePaid?: number
}

/** Quick calculation for API (no DB) — used by existing POST /api/hr/salary/calculate */
export function calculateSalary(input: SalaryInput) {
  const standardDays = input.standardDays || WORKING_DAYS.standardPerMonth
  const actualDays = input.workingDays || standardDays
  const proRatedBase = Math.round((input.baseSalary / standardDays) * actualDays)

  const hourlyRate = input.baseSalary / standardDays / 8
  const otRate = input.overtimeRate || WORKING_DAYS.overtimeRate
  const overtimeAmount = Math.round((input.overtimeHours || 0) * hourlyRate * otRate)

  const pieceRate = input.pieceRateAmount || 0
  const allowances = input.allowances || 0
  const gross = proRatedBase + overtimeAmount + pieceRate + allowances

  const ins = calculateInsurance(input.baseSalary)
  const ded = calculateDeduction(input.dependents || 0)
  const taxableIncome = Math.max(0, gross - ins.employee.total - ded.total)
  const tax = calculateTax(taxableIncome)
  const net = gross - ins.employee.total - tax.taxAmount - (input.advancePaid || 0)

  return {
    gross,
    proRatedBase,
    overtimeAmount,
    pieceRateAmount: pieceRate,
    allowances,
    insurance: ins,
    deduction: ded,
    taxableIncome,
    tax: tax.taxAmount,
    taxBracket: tax.bracket,
    effectiveRate: tax.effectiveRate,
    advancePaid: input.advancePaid || 0,
    net,
    totalCostToCompany: gross + ins.employer.total,
  }
}

/** Full monthly salary calculation with DB lookup */
export async function calculateMonthlySalary(
  employeeId: string,
  month: number,
  year: number,
): Promise<SalaryBreakdown> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: {
      user: true,
      department: { select: { code: true } },
      contracts: {
        where: {
          status: 'ACTIVE',
          startDate: { lte: new Date(year, month - 1, 28) },
          OR: [
            { endDate: null },
            { endDate: { gte: new Date(year, month - 1, 1) } },
          ],
        },
        orderBy: { startDate: 'desc' },
        take: 1,
      },
    },
  })

  if (!employee) throw new Error('Employee not found')

  const contract = employee.contracts[0]
  const baseSalary = contract ? Number(contract.baseSalary) : 0
  const dependentCount = employee.dependents || 0
  const distanceKm = employee.distanceKm || 0
  const standardDays = contract?.workDays || WORKING_DAYS.standardPerMonth

  // Attendance: aggregate daily records for this month
  const startDate = new Date(year, month - 1, 1)
  const endDate = new Date(year, month, 0, 23, 59, 59)
  const attendanceRecords = await prisma.attendance.findMany({
    where: {
      employeeId,
      date: { gte: startDate, lte: endDate },
      status: { in: ['PRESENT', 'LATE', 'HALF_DAY'] },
    },
  })

  let actualDays = 0
  let overtimeHours = 0
  for (const a of attendanceRecords) {
    actualDays += a.status === 'HALF_DAY' ? 0.5 : 1
    overtimeHours += Number(a.overtime || 0)
  }

  if (actualDays === 0) actualDays = standardDays // Default if no attendance logged

  const proRatedBase = Math.round((baseSalary / standardDays) * actualDays)
  const hourlyRate = baseSalary / standardDays / 8
  const overtimeAmount = Math.round(overtimeHours * hourlyRate * WORKING_DAYS.overtimeRate)

  // Piece-rate income (via PieceRateContract → MonthlyPieceRateOutput)
  let pieceRateAmount = 0
  if (employee.department?.code) {
    const outputs = await prisma.monthlyPieceRateOutput.findMany({
      where: {
        month, year,
        contract: { teamCode: employee.department.code },
      },
      include: { contract: true },
    })
    for (const output of outputs) {
      pieceRateAmount += Number(output.quantity) * Number(output.unitPrice)
    }
  }

  // Allowances
  const fuelAllowance = distanceKm > ALLOWANCES.fuelThreshold ? ALLOWANCES.fuelAmount : 0
  const mealAllowance = ALLOWANCES.mealDefault
  const otherAllowance = contract ? Number(contract.allowances || 0) : 0
  const totalAllowances = fuelAllowance + mealAllowance + otherAllowance

  // Gross
  const grossSalary = proRatedBase + overtimeAmount + pieceRateAmount + totalAllowances

  // Insurance
  const insurance = calculateInsurance(baseSalary)

  // Deductions
  const deduction = calculateDeduction(dependentCount)

  // Taxable
  const taxableIncome = Math.max(0, grossSalary - insurance.employee.total - deduction.total)
  const { taxAmount, bracket: taxBracket, effectiveRate } = calculateTax(taxableIncome)

  // Net
  const netSalary = grossSalary - insurance.employee.total - taxAmount
  const totalCostToCompany = grossSalary + insurance.employer.total

  return {
    employeeId,
    employeeName: employee.user?.fullName || employee.fullName || 'N/A',
    month, year,
    baseSalary, actualDays, standardDays, proRatedBase,
    overtimeHours, overtimeAmount, pieceRateAmount,
    fuelAllowance, mealAllowance, otherAllowance, totalAllowances,
    grossSalary, insurance, taxableIncome,
    deduction: { self: deduction.selfDeduction, dependent: deduction.dependentDeduction, total: deduction.total },
    taxAmount, taxBracket, effectiveRate, netSalary, totalCostToCompany,
  }
}

/** Batch calculate for all employees */
export async function calculateAllSalaries(month: number, year: number) {
  const employees = await prisma.employee.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
  })

  const results: SalaryBreakdown[] = []
  const errors: { employeeId: string; error: string }[] = []

  for (const emp of employees) {
    try {
      results.push(await calculateMonthlySalary(emp.id, month, year))
    } catch (err) {
      errors.push({ employeeId: emp.id, error: err instanceof Error ? err.message : 'Unknown' })
    }
  }
  return { results, errors }
}

/** Save results to SalaryRecord (matching schema fields exactly) */
export async function saveSalaryRecords(results: SalaryBreakdown[], calculatedBy: string) {
  let saved = 0
  for (const r of results) {
    await prisma.salaryRecord.upsert({
      where: { employeeId_month_year: { employeeId: r.employeeId, month: r.month, year: r.year } },
      update: {
        baseSalary: r.baseSalary,
        workDays: r.standardDays,
        actualDays: r.actualDays,
        overtimeHours: r.overtimeHours,
        overtimePay: r.overtimeAmount,
        allowances: r.totalAllowances,
        socialInsurance: r.insurance.employee.bhxh,
        healthInsurance: r.insurance.employee.bhyt,
        unemploymentIns: r.insurance.employee.bhtn,
        taxableIncome: r.taxableIncome,
        personalTax: r.taxAmount,
        deductions: r.deduction.total,
        netSalary: r.netSalary,
        status: 'CALCULATED',
        calculatedAt: new Date(),
      },
      create: {
        employeeId: r.employeeId,
        month: r.month,
        year: r.year,
        baseSalary: r.baseSalary,
        workDays: r.standardDays,
        actualDays: r.actualDays,
        overtimeHours: r.overtimeHours,
        overtimePay: r.overtimeAmount,
        allowances: r.totalAllowances,
        socialInsurance: r.insurance.employee.bhxh,
        healthInsurance: r.insurance.employee.bhyt,
        unemploymentIns: r.insurance.employee.bhtn,
        taxableIncome: r.taxableIncome,
        personalTax: r.taxAmount,
        deductions: r.deduction.total,
        netSalary: r.netSalary,
        status: 'CALCULATED',
        calculatedAt: new Date(),
      },
    })
    saved++
  }
  return saved
}
