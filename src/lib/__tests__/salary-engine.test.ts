// ── Mock Prisma ──
import { prismaMock } from '@/lib/__mocks__/db'

import { calculateSalary, calculateMonthlySalary } from '@/lib/salary-engine'
import {
  calculateInsurance,
  calculateTax,
  calculateDeduction,
  INSURANCE_RATES,
  DEDUCTIONS,
  ALLOWANCES,
  WORKING_DAYS,
  TAX_BRACKETS,
} from '@/lib/salary-config'

// mockReset is handled by __mocks__/db.ts beforeEach

// ══════════════════════════════════════════════
//  salary-config helpers (pure functions)
// ══════════════════════════════════════════════

describe('calculateInsurance', () => {
  it('computes employee contributions at 8% + 1.5% + 1% = 10.5%', () => {
    const ins = calculateInsurance(10_000_000)
    expect(ins.employee.bhxh).toBe(800_000)
    expect(ins.employee.bhyt).toBe(150_000)
    expect(ins.employee.bhtn).toBe(100_000)
    expect(ins.employee.total).toBe(1_050_000)
  })

  it('computes employer contributions at 17.5% + 3% + 1% = 21.5%', () => {
    const ins = calculateInsurance(10_000_000)
    expect(ins.employer.bhxh).toBe(1_750_000)
    expect(ins.employer.bhyt).toBe(300_000)
    expect(ins.employer.bhtn).toBe(100_000)
    expect(ins.employer.total).toBe(2_150_000)
  })

  it('caps salary base at maxSalaryBase (46.8M)', () => {
    const ins = calculateInsurance(100_000_000) // way above cap
    expect(ins.salaryBase).toBe(INSURANCE_RATES.maxSalaryBase)
    expect(ins.employee.total).toBe(
      Math.round(INSURANCE_RATES.maxSalaryBase * INSURANCE_RATES.employee.total),
    )
  })

  it('returns 0 for 0 salary', () => {
    const ins = calculateInsurance(0)
    expect(ins.employee.total).toBe(0)
    expect(ins.employer.total).toBe(0)
    expect(ins.salaryBase).toBe(0)
  })
})

describe('calculateDeduction', () => {
  it('returns 11M self deduction with 0 dependents', () => {
    const d = calculateDeduction(0)
    expect(d.selfDeduction).toBe(11_000_000)
    expect(d.dependentDeduction).toBe(0)
    expect(d.total).toBe(11_000_000)
  })

  it('adds 4.4M per dependent', () => {
    const d = calculateDeduction(2)
    expect(d.dependentDeduction).toBe(8_800_000)
    expect(d.total).toBe(11_000_000 + 8_800_000)
  })
})

describe('calculateTax', () => {
  it('returns 0 for 0 taxable income', () => {
    const t = calculateTax(0)
    expect(t.taxAmount).toBe(0)
    expect(t.bracket).toBe(0)
    expect(t.effectiveRate).toBe(0)
  })

  it('returns 0 for negative taxable income', () => {
    const t = calculateTax(-1_000_000)
    expect(t.taxAmount).toBe(0)
  })

  // Bracket 1: 0–5M at 5%
  it('bracket 1: 3M taxable → 150k tax', () => {
    const t = calculateTax(3_000_000)
    expect(t.taxAmount).toBe(150_000)
    expect(t.bracket).toBe(1)
  })

  it('bracket 1 boundary: exactly 5M → 250k tax', () => {
    const t = calculateTax(5_000_000)
    // 5M * 5% - 0 = 250k
    expect(t.taxAmount).toBe(250_000)
    expect(t.bracket).toBe(1)
  })

  // Bracket 2: 5M–10M at 10%
  it('bracket 2: 7M taxable → 450k tax', () => {
    // 7M * 10% - 250k = 450k
    const t = calculateTax(7_000_000)
    expect(t.taxAmount).toBe(450_000)
    expect(t.bracket).toBe(2)
  })

  it('bracket 2 boundary: exactly 10M → 750k tax', () => {
    // 10M * 10% - 250k = 750k
    const t = calculateTax(10_000_000)
    expect(t.taxAmount).toBe(750_000)
    expect(t.bracket).toBe(2)
  })

  // Bracket 3: 10M–18M at 15%
  it('bracket 3: 15M taxable → 1.5M tax', () => {
    // 15M * 15% - 750k = 1,500k
    const t = calculateTax(15_000_000)
    expect(t.taxAmount).toBe(1_500_000)
    expect(t.bracket).toBe(3)
  })

  it('bracket 3 boundary: exactly 18M → 1.95M tax', () => {
    // 18M * 15% - 750k = 1,950k
    const t = calculateTax(18_000_000)
    expect(t.taxAmount).toBe(1_950_000)
    expect(t.bracket).toBe(3)
  })

  // Bracket 4: 18M–32M at 20%
  it('bracket 4: 25M taxable → 3.35M tax', () => {
    // 25M * 20% - 1,650k = 3,350k
    const t = calculateTax(25_000_000)
    expect(t.taxAmount).toBe(3_350_000)
    expect(t.bracket).toBe(4)
  })

  it('bracket 4 boundary: exactly 32M → 4.75M tax', () => {
    // 32M * 20% - 1,650k = 4,750k
    const t = calculateTax(32_000_000)
    expect(t.taxAmount).toBe(4_750_000)
    expect(t.bracket).toBe(4)
  })

  // Bracket 5: 32M–52M at 25%
  it('bracket 5 boundary: exactly 52M → 9.75M tax', () => {
    // 52M * 25% - 3,250k = 9,750k
    const t = calculateTax(52_000_000)
    expect(t.taxAmount).toBe(9_750_000)
    expect(t.bracket).toBe(5)
  })

  // Bracket 6: 52M–80M at 30%
  it('bracket 6 boundary: exactly 80M → 18.15M tax', () => {
    // 80M * 30% - 5,850k = 18,150k
    const t = calculateTax(80_000_000)
    expect(t.taxAmount).toBe(18_150_000)
    expect(t.bracket).toBe(6)
  })

  // Bracket 7: >80M at 35%
  it('bracket 7: 100M taxable → 25.15M tax', () => {
    // 100M * 35% - 9,850k = 25,150k
    const t = calculateTax(100_000_000)
    expect(t.taxAmount).toBe(25_150_000)
    expect(t.bracket).toBe(7)
  })

  it('effective rate is computed correctly', () => {
    const t = calculateTax(10_000_000)
    // 750k / 10M = 0.075
    expect(t.effectiveRate).toBe(0.075)
  })
})

// ══════════════════════════════════════════════
//  calculateSalary (pure, no DB)
// ══════════════════════════════════════════════

describe('calculateSalary', () => {
  it('standard 26-day month, no OT, no extras', () => {
    const result = calculateSalary({ baseSalary: 10_000_000 })
    expect(result.proRatedBase).toBe(10_000_000)
    expect(result.overtimeAmount).toBe(0)
    expect(result.pieceRateAmount).toBe(0)
    expect(result.allowances).toBe(0)
    expect(result.gross).toBe(10_000_000)
    // Insurance: 10M * 10.5% = 1,050,000
    expect(result.insurance.employee.total).toBe(1_050_000)
    // Deduction: 11M self
    // Taxable: 10M - 1.05M - 11M = -2.05M → 0
    expect(result.taxableIncome).toBe(0)
    expect(result.tax).toBe(0)
    expect(result.net).toBe(10_000_000 - 1_050_000) // 8,950,000
  })

  it('partial month: 15 of 26 days pro-rated', () => {
    const result = calculateSalary({
      baseSalary: 10_000_000,
      workingDays: 15,
      standardDays: 26,
    })
    // 10M / 26 * 15 = 5,769,231 (rounded)
    expect(result.proRatedBase).toBe(Math.round((10_000_000 / 26) * 15))
    expect(result.gross).toBe(result.proRatedBase)
  })

  it('with overtime hours at 1.5x', () => {
    const result = calculateSalary({
      baseSalary: 10_000_000,
      overtimeHours: 10,
    })
    const hourlyRate = 10_000_000 / 26 / 8
    const expectedOT = Math.round(10 * hourlyRate * 1.5)
    expect(result.overtimeAmount).toBe(expectedOT)
    expect(result.gross).toBe(10_000_000 + expectedOT)
  })

  it('with custom overtime rate', () => {
    const result = calculateSalary({
      baseSalary: 10_000_000,
      overtimeHours: 8,
      overtimeRate: 2.0,
    })
    const hourlyRate = 10_000_000 / 26 / 8
    const expectedOT = Math.round(8 * hourlyRate * 2.0)
    expect(result.overtimeAmount).toBe(expectedOT)
  })

  it('with piece-rate income', () => {
    const result = calculateSalary({
      baseSalary: 10_000_000,
      pieceRateAmount: 2_000_000,
    })
    expect(result.pieceRateAmount).toBe(2_000_000)
    expect(result.gross).toBe(12_000_000)
  })

  it('with allowances', () => {
    const result = calculateSalary({
      baseSalary: 10_000_000,
      allowances: 1_500_000,
    })
    expect(result.allowances).toBe(1_500_000)
    expect(result.gross).toBe(11_500_000)
  })

  it('deducts advance paid from net', () => {
    const result = calculateSalary({
      baseSalary: 10_000_000,
      advancePaid: 2_000_000,
    })
    expect(result.advancePaid).toBe(2_000_000)
    // net = gross - ins - tax - advance
    const noAdvance = calculateSalary({ baseSalary: 10_000_000 })
    expect(result.net).toBe(noAdvance.net - 2_000_000)
  })

  it('high salary triggers progressive tax', () => {
    // 30M base, full month, no extras
    const result = calculateSalary({ baseSalary: 30_000_000 })
    // Insurance: 30M * 10.5% = 3,150,000
    // Deduction: 11M
    // Taxable: 30M - 3.15M - 11M = 15,850,000
    expect(result.taxableIncome).toBe(15_850_000)
    // Bracket 3: 15.85M * 15% - 750k = 1,627,500
    expect(result.tax).toBe(Math.round(15_850_000 * 0.15 - 750_000))
    expect(result.taxBracket).toBe(3)
  })

  it('with dependents reduces taxable income', () => {
    const noDep = calculateSalary({ baseSalary: 30_000_000, dependents: 0 })
    const twoDep = calculateSalary({ baseSalary: 30_000_000, dependents: 2 })
    // 2 dependents = 2 * 4.4M = 8.8M less taxable
    expect(twoDep.taxableIncome).toBe(noDep.taxableIncome - 8_800_000)
    expect(twoDep.tax).toBeLessThan(noDep.tax)
  })

  it('net = gross - insurance - tax', () => {
    const result = calculateSalary({ baseSalary: 20_000_000 })
    expect(result.net).toBe(result.gross - result.insurance.employee.total - result.tax)
  })

  it('totalCostToCompany = gross + employer insurance', () => {
    const result = calculateSalary({ baseSalary: 20_000_000 })
    expect(result.totalCostToCompany).toBe(result.gross + result.insurance.employer.total)
  })

  it('handles partial month + OT + piece rate + allowances combined', () => {
    const result = calculateSalary({
      baseSalary: 15_000_000,
      workingDays: 20,
      standardDays: 26,
      overtimeHours: 5,
      pieceRateAmount: 1_000_000,
      allowances: 500_000,
      dependents: 1,
    })
    const proRated = Math.round((15_000_000 / 26) * 20)
    const hourly = 15_000_000 / 26 / 8
    const ot = Math.round(5 * hourly * 1.5)
    expect(result.proRatedBase).toBe(proRated)
    expect(result.overtimeAmount).toBe(ot)
    expect(result.gross).toBe(proRated + ot + 1_000_000 + 500_000)
  })
})

// ══════════════════════════════════════════════
//  calculateMonthlySalary (with mocked Prisma)
// ══════════════════════════════════════════════

describe('calculateMonthlySalary', () => {
  it('throws when employee not found', async () => {
    prismaMock.employee.findUnique.mockResolvedValue(null)
    await expect(calculateMonthlySalary('emp-1', 3, 2026)).rejects.toThrow(
      'Employee not found',
    )
  })

  it('calculates full month salary with attendance and contract', async () => {
    prismaMock.employee.findUnique.mockResolvedValue({
      id: 'emp-1',
      fullName: 'Nguyen Van A',
      dependents: 1,
      distanceKm: 25, // > 20km threshold
      status: 'ACTIVE',
      user: { fullName: 'Nguyen Van A' },
      department: { code: 'DEV' },
      contracts: [
        {
          baseSalary: 20_000_000,
          allowances: 500_000,
          workDays: 26,
          status: 'ACTIVE',
          startDate: new Date(2025, 0, 1),
          endDate: null,
        },
      ],
    } as any)

    // 22 present days + 2 half days + 10 hours OT total
    prismaMock.attendance.findMany.mockResolvedValue([
      ...Array.from({ length: 22 }, (_, i) => ({
        id: `att-${i}`,
        employeeId: 'emp-1',
        date: new Date(2026, 2, i + 1),
        status: 'PRESENT',
        overtime: 0,
      })),
      {
        id: 'att-22',
        employeeId: 'emp-1',
        date: new Date(2026, 2, 23),
        status: 'HALF_DAY',
        overtime: 5,
      },
      {
        id: 'att-23',
        employeeId: 'emp-1',
        date: new Date(2026, 2, 24),
        status: 'HALF_DAY',
        overtime: 5,
      },
    ] as any)

    // Piece rate: 10 units * 50k = 500k
    prismaMock.monthlyPieceRateOutput.findMany.mockResolvedValue([
      { quantity: 10, unitPrice: 50_000, contract: { teamCode: 'DEV' } },
    ] as any)

    const result = await calculateMonthlySalary('emp-1', 3, 2026)

    // 22 full + 2 half = 23 days
    expect(result.actualDays).toBe(23)
    expect(result.overtimeHours).toBe(10)
    expect(result.baseSalary).toBe(20_000_000)
    expect(result.standardDays).toBe(26)
    expect(result.proRatedBase).toBe(Math.round((20_000_000 / 26) * 23))
    expect(result.pieceRateAmount).toBe(500_000)

    // Fuel allowance: 25km > 20km → 200k
    expect(result.fuelAllowance).toBe(200_000)
    expect(result.mealAllowance).toBe(730_000)
    expect(result.otherAllowance).toBe(500_000)

    // Insurance on 20M base
    expect(result.insurance.employee.total).toBe(
      Math.round(20_000_000 * INSURANCE_RATES.employee.total),
    )

    expect(result.employeeName).toBe('Nguyen Van A')
    expect(result.month).toBe(3)
    expect(result.year).toBe(2026)

    // Net = gross - employee insurance - tax
    expect(result.netSalary).toBe(
      result.grossSalary - result.insurance.employee.total - result.taxAmount,
    )
  })

  it('defaults to standardDays when no attendance records', async () => {
    prismaMock.employee.findUnique.mockResolvedValue({
      id: 'emp-2',
      fullName: 'Tran B',
      dependents: 0,
      distanceKm: 10, // < 20km
      status: 'ACTIVE',
      user: null,
      department: null,
      contracts: [
        {
          baseSalary: 15_000_000,
          allowances: 0,
          workDays: 26,
          status: 'ACTIVE',
          startDate: new Date(2025, 0, 1),
          endDate: null,
        },
      ],
    } as any)

    prismaMock.attendance.findMany.mockResolvedValue([])

    const result = await calculateMonthlySalary('emp-2', 3, 2026)

    // No attendance → defaults to standardDays
    expect(result.actualDays).toBe(26)
    expect(result.proRatedBase).toBe(15_000_000)
    // distance < 20 → no fuel
    expect(result.fuelAllowance).toBe(0)
    // No user → falls back to fullName
    expect(result.employeeName).toBe('Tran B')
    // No department → no piece rate lookup
    expect(result.pieceRateAmount).toBe(0)
  })

  it('handles employee with no contract (0 base salary)', async () => {
    prismaMock.employee.findUnique.mockResolvedValue({
      id: 'emp-3',
      fullName: null,
      dependents: 0,
      distanceKm: 0,
      status: 'ACTIVE',
      user: null,
      department: null,
      contracts: [],
    } as any)

    prismaMock.attendance.findMany.mockResolvedValue([])

    const result = await calculateMonthlySalary('emp-3', 1, 2026)

    expect(result.baseSalary).toBe(0)
    expect(result.grossSalary).toBe(ALLOWANCES.mealDefault) // only meal allowance
    expect(result.employeeName).toBe('N/A')
  })
})
