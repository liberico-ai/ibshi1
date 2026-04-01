// ══════════════════════════════════════════════════════
//  SALARY CONFIGURATION — BRD §3
//  BHXH/BHYT/BHTN rates, Tax brackets, Deductions
// ══════════════════════════════════════════════════════

// ── Insurance Rates (2026) ──

export const INSURANCE_RATES = {
  employee: {
    bhxh: 0.08,    // 8% BHXH
    bhyt: 0.015,   // 1.5% BHYT
    bhtn: 0.01,    // 1% BHTN
    total: 0.105,  // 10.5% tổng
  },
  employer: {
    bhxh: 0.175,   // 17.5% BHXH
    bhyt: 0.03,    // 3% BHYT
    bhtn: 0.01,    // 1% BHTN
    total: 0.215,  // 21.5% tổng
  },
  maxSalaryBase: 46_800_000, // Mức trần đóng BHXH (20x mức lương cơ sở 2.34M)
} as const

// ── Personal Income Tax — 7 Progressive Brackets ──

export interface TaxBracket {
  from: number
  to: number
  rate: number
  quickDeduction: number
}

export const TAX_BRACKETS: TaxBracket[] = [
  { from: 0,          to: 5_000_000,    rate: 0.05, quickDeduction: 0 },
  { from: 5_000_000,  to: 10_000_000,   rate: 0.10, quickDeduction: 250_000 },
  { from: 10_000_000, to: 18_000_000,   rate: 0.15, quickDeduction: 750_000 },
  { from: 18_000_000, to: 32_000_000,   rate: 0.20, quickDeduction: 1_650_000 },
  { from: 32_000_000, to: 52_000_000,   rate: 0.25, quickDeduction: 3_250_000 },
  { from: 52_000_000, to: 80_000_000,   rate: 0.30, quickDeduction: 5_850_000 },
  { from: 80_000_000, to: Infinity,     rate: 0.35, quickDeduction: 9_850_000 },
]

// ── Personal Deductions (Giảm trừ gia cảnh) ──

export const DEDUCTIONS = {
  self: 11_000_000,         // 11M/tháng cho bản thân
  dependent: 4_400_000,     // 4.4M/tháng mỗi người phụ thuộc
} as const

// ── Allowances ──

export const ALLOWANCES = {
  fuelThreshold: 20,        // km — khoảng cách tối thiểu
  fuelAmount: 200_000,      // 200k/tháng nếu > 20km
  mealDefault: 730_000,     // Phụ cấp ăn ca mặc định/tháng
  phoneDefault: 0,          // Phụ cấp điện thoại (tùy HĐ)
} as const

// ── Working Days ──

export const WORKING_DAYS = {
  standardPerMonth: 26,     // 26 ngày công chuẩn/tháng
  overtimeRate: 1.5,        // Hệ số tăng ca ngày thường
  overtimeWeekend: 2.0,     // Hệ số tăng ca cuối tuần
  overtimeHoliday: 3.0,     // Hệ số tăng ca ngày lễ
} as const

// ── Salary Calculation Helper ──

/** Calculate personal income tax using progressive brackets + quick deduction method */
export function calculateTax(taxableIncome: number): {
  taxAmount: number
  bracket: number
  effectiveRate: number
} {
  if (taxableIncome <= 0) return { taxAmount: 0, bracket: 0, effectiveRate: 0 }

  let bracket = 0
  for (let i = TAX_BRACKETS.length - 1; i >= 0; i--) {
    if (taxableIncome > TAX_BRACKETS[i].from) {
      bracket = i + 1
      break
    }
  }

  const b = TAX_BRACKETS[bracket - 1] || TAX_BRACKETS[0]
  const taxAmount = taxableIncome * b.rate - b.quickDeduction
  const effectiveRate = taxableIncome > 0 ? taxAmount / taxableIncome : 0

  return {
    taxAmount: Math.max(0, Math.round(taxAmount)),
    bracket,
    effectiveRate: Math.round(effectiveRate * 10000) / 10000,
  }
}

/** Calculate insurance amounts for employee and employer */
export function calculateInsurance(baseSalary: number): {
  employee: { bhxh: number; bhyt: number; bhtn: number; total: number }
  employer: { bhxh: number; bhyt: number; bhtn: number; total: number }
  salaryBase: number
} {
  // Cap at max salary base
  const salaryBase = Math.min(baseSalary, INSURANCE_RATES.maxSalaryBase)

  return {
    employee: {
      bhxh: Math.round(salaryBase * INSURANCE_RATES.employee.bhxh),
      bhyt: Math.round(salaryBase * INSURANCE_RATES.employee.bhyt),
      bhtn: Math.round(salaryBase * INSURANCE_RATES.employee.bhtn),
      total: Math.round(salaryBase * INSURANCE_RATES.employee.total),
    },
    employer: {
      bhxh: Math.round(salaryBase * INSURANCE_RATES.employer.bhxh),
      bhyt: Math.round(salaryBase * INSURANCE_RATES.employer.bhyt),
      bhtn: Math.round(salaryBase * INSURANCE_RATES.employer.bhtn),
      total: Math.round(salaryBase * INSURANCE_RATES.employer.total),
    },
    salaryBase,
  }
}

/** Calculate personal deduction amount */
export function calculateDeduction(dependentCount: number): {
  selfDeduction: number
  dependentDeduction: number
  total: number
} {
  const selfDeduction = DEDUCTIONS.self
  const dependentDeduction = dependentCount * DEDUCTIONS.dependent
  return {
    selfDeduction,
    dependentDeduction,
    total: selfDeduction + dependentDeduction,
  }
}
