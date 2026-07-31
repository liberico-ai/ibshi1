import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import type { ExecAnnualPlan } from '@/lib/exec-indicators'

// Kế hoạch (KH) tháng + năm cho Tab Điều hành — lưu zero-schema trong SystemConfig.
// key = exec_plan:{year} ; value = { year, annual, indicators: { [key]: { monthly: {1..12} } } }

const VIEW_ROLES = ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R08', 'R08a', 'R10']
const EDIT_ROLES = ['R01', 'R03', 'R03a', 'R10']   // KTKH + BGĐ + Admin lập kế hoạch

interface ExecPlanDoc {
  year: number
  annual: ExecAnnualPlan
  indicators: Record<string, { monthly: Record<string, number> }>
}

function emptyPlan(year: number): ExecPlanDoc {
  return { year, annual: {}, indicators: {} }
}

async function readPlan(year: number): Promise<ExecPlanDoc> {
  const row = await prisma.systemConfig.findUnique({ where: { key: `exec_plan:${year}` } })
  if (!row?.value) return emptyPlan(year)
  try { return { ...emptyPlan(year), ...JSON.parse(row.value) } } catch { return emptyPlan(year) }
}

// GET /api/reports/exec-plan?year=2026
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, VIEW_ROLES)) return errorResponse('Không có quyền xem kế hoạch điều hành', 403)

  const year = parseInt(new URL(req.url).searchParams.get('year') || '') || new Date().getFullYear()
  const plan = await readPlan(year)
  return successResponse({ plan, canEdit: requireRoles(user.roleCode, EDIT_ROLES) })
}

// PUT /api/reports/exec-plan — body: { year, annual, indicators }
export async function PUT(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, EDIT_ROLES)) return errorResponse('Chỉ KTKH / BGĐ được lập kế hoạch', 403)

  const body = await req.json().catch(() => null)
  const year = Number(body?.year)
  if (!year || year < 2000 || year > 2100) return errorResponse('Năm không hợp lệ', 400)

  const doc: ExecPlanDoc = {
    year,
    annual: (body?.annual && typeof body.annual === 'object') ? body.annual : {},
    indicators: (body?.indicators && typeof body.indicators === 'object') ? body.indicators : {},
  }
  await prisma.systemConfig.upsert({
    where: { key: `exec_plan:${year}` },
    update: { value: JSON.stringify(doc) },
    create: { key: `exec_plan:${year}`, value: JSON.stringify(doc) },
  })
  return successResponse({ plan: doc }, 'Đã lưu kế hoạch')
}
