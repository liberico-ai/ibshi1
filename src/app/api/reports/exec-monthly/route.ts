import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { EXEC_INDICATORS } from '@/lib/exec-indicators'

// Tổng hợp TH (thực hiện) 13 chỉ số tháng cho Tab Điều hành + lũy kế + merge KH + nhập tay.
// TH auto tự sinh từ ERP; chỉ số manual lấy từ SystemConfig exec_actual:{year}.

const VIEW_ROLES = ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R08', 'R08a', 'R10']
const EDIT_ROLES = ['R01', 'R03', 'R03a', 'R10']

const num = (x: unknown): number => (x == null ? 0 : Number(x))

// Tính các chỉ số AUTO cho khoảng tháng [monthFrom..monthTo] của năm.
async function computeAuto(year: number, monthFrom: number, monthTo: number): Promise<Record<string, number | null>> {
  const start = new Date(year, monthFrom - 1, 1)
  const end = new Date(year, monthTo, 1) // exclusive

  const [contractVal, revenue, recovery, volFactory, salary, inspGroups, headcount] = await Promise.all([
    prisma.project.aggregate({ _sum: { contractValue: true }, where: { createdAt: { gte: start, lt: end } } }),
    prisma.invoice.aggregate({ _sum: { totalAmount: true }, where: { projectId: { not: null }, vendorId: null, createdAt: { gte: start, lt: end } } }),
    prisma.customerReceipt.aggregate({ _sum: { amount: true }, where: { receivedAt: { gte: start, lt: end } } }),
    prisma.dailyProductionLog.aggregate({ _sum: { reportedVolume: true }, where: { reportDate: { gte: start, lt: end } } }),
    prisma.salaryRecord.aggregate({ _sum: { netSalary: true }, where: { year, month: { gte: monthFrom, lte: monthTo } } }),
    prisma.inspection.groupBy({ by: ['status'], _count: { _all: true }, where: { inspectedAt: { gte: start, lt: end } } }),
    prisma.employee.count({ where: { status: 'ACTIVE' } }),
  ])

  const volKg = num(volFactory._sum.reportedVolume)
  const salaryCost = num(salary._sum.netSalary)
  const passed = inspGroups.find(g => g.status === 'PASSED')?._count._all || 0
  const failed = inspGroups.find(g => g.status === 'FAILED')?._count._all || 0
  const inspTotal = passed + failed

  return {
    contract_new_value: num(contractVal._sum.contractValue),
    revenue: num(revenue._sum.totalAmount),
    capital_recovery: num(recovery._sum.amount),
    volume_factory: volKg,
    salary_cost: salaryCost,
    productivity: headcount > 0 ? +(volKg / 1000 / headcount).toFixed(3) : null,
    avg_salary: headcount > 0 ? Math.round(salaryCost / headcount) : null,
    defect_rate: inspTotal > 0 ? +((failed / inspTotal) * 100).toFixed(2) : null,
  }
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.systemConfig.findUnique({ where: { key } })
  if (!row?.value) return fallback
  try { return JSON.parse(row.value) as T } catch { return fallback }
}

interface PlanDoc { annual?: Record<string, number>; indicators?: Record<string, { monthly?: Record<string, number> }> }
type ActualDoc = Record<string, Record<string, number>> // { [month]: { [key]: value } }

// GET /api/reports/exec-monthly?period=2026-03
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, VIEW_ROLES)) return errorResponse('Không có quyền xem báo cáo điều hành', 403)

  const period = new URL(req.url).searchParams.get('period') || ''
  const m = /^(\d{4})-(\d{1,2})$/.exec(period)
  const now = new Date()
  const year = m ? parseInt(m[1]) : now.getFullYear()
  const month = m ? Math.min(12, Math.max(1, parseInt(m[2]))) : now.getMonth() + 1

  const [monthAuto, cumAuto, plan, actual] = await Promise.all([
    computeAuto(year, month, month),
    computeAuto(year, 1, month),
    readJson<PlanDoc>(`exec_plan:${year}`, {}),
    readJson<ActualDoc>(`exec_actual:${year}`, {}),
  ])

  const manualCum = (key: string): number | null => {
    let has = false, sum = 0
    for (let mm = 1; mm <= month; mm++) {
      const v = actual[String(mm)]?.[key]
      if (typeof v === 'number') { has = true; sum += v }
    }
    return has ? sum : null
  }

  const rows = EXEC_INDICATORS.map(ind => {
    const kh = plan.indicators?.[ind.key]?.monthly?.[String(month)] ?? null
    let th: number | null, luyKe: number | null
    if (ind.source === 'auto') {
      th = monthAuto[ind.key] ?? null
      luyKe = cumAuto[ind.key] ?? null
    } else {
      th = actual[String(month)]?.[ind.key] ?? null
      luyKe = manualCum(ind.key)
    }
    return { ...ind, kh, th, luyKe }
  })

  return successResponse({
    year, month,
    annual: plan.annual || {},
    rows,
    canEdit: requireRoles(user.roleCode, EDIT_ROLES),
  })
}

// POST /api/reports/exec-monthly — lưu TH nhập tay: body { year, month, values: { [key]: number } }
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, EDIT_ROLES)) return errorResponse('Không có quyền nhập số liệu', 403)

  const body = await req.json().catch(() => null)
  const year = Number(body?.year)
  const month = Number(body?.month)
  if (!year || month < 1 || month > 12) return errorResponse('Kỳ không hợp lệ', 400)
  const values = (body?.values && typeof body.values === 'object') ? body.values as Record<string, number> : {}

  const doc = await readJson<ActualDoc>(`exec_actual:${year}`, {})
  doc[String(month)] = { ...(doc[String(month)] || {}), ...values }
  await prisma.systemConfig.upsert({
    where: { key: `exec_actual:${year}` },
    update: { value: JSON.stringify(doc) },
    create: { key: `exec_actual:${year}`, value: JSON.stringify(doc) },
  })
  return successResponse({ ok: true }, 'Đã lưu số liệu thực hiện')
}
