import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import {
  authenticateRequest, successResponse, errorResponse, unauthorizedResponse,
  forbiddenResponse, getUserProjectIds, logAudit, getClientIP,
} from '@/lib/auth'
import { FINANCE_WRITE_ROLES } from '@/lib/constants'
import { calcProjectActualCosts } from '@/lib/sync-engine'

// ══════════════════════════════════════════════════════
//  Quyết toán dự án (ProjectSettlement) — Track B
//  Nguồn số (chống double-count, đồng bộ với recalcBudgetActual):
//  - revenueContract  = Project.contractValue
//  - revenueInvoiced  = Σ Invoice RECEIVABLE totalAmount
//  - revenueCollected = Σ Invoice RECEIVABLE paidAmount
//  - costMaterial/Labor/Service = calcProjectActualCosts (sync-engine — GRN / khoán VERIFIED / hóa đơn CHI paidAmount không gắn PO vật tư)
//  - costOther        = Σ Budget.actual các category NGOÀI MATERIAL/LABOR/SERVICE
//  - profit = revenueContract − totalCost; marginPct = profit / revenueContract × 100
// ══════════════════════════════════════════════════════

const CORE_COST_CATEGORIES = ['MATERIAL', 'LABOR', 'SERVICE']
const round2 = (n: number) => Math.round(n * 100) / 100

interface SettlementNumbers {
  revenueContract: number
  revenueInvoiced: number
  revenueCollected: number
  costMaterial: number
  costLabor: number
  costService: number
  costOther: number
  totalCost: number
  profit: number
  marginPct: number
}

interface ComputedSettlement {
  numbers: SettlementNumbers
  budgets: { category: string; planned: number; actual: number; committed: number }[]
  snapshot: Record<string, unknown>
}

/** Tính số quyết toán live từ dữ liệu thật. Trả null nếu dự án không tồn tại. */
async function computeSettlement(projectId: string): Promise<ComputedSettlement | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, projectCode: true, contractValue: true },
  })
  if (!project) return null

  // Doanh thu: hợp đồng + hóa đơn AR
  const receivables = await prisma.invoice.findMany({
    where: { projectId, type: 'RECEIVABLE' },
    select: { totalAmount: true, paidAmount: true },
  })
  const revenueContract = Number(project.contractValue || 0)
  const revenueInvoiced = receivables.reduce((s, i) => s + Number(i.totalAmount), 0)
  const revenueCollected = receivables.reduce((s, i) => s + Number(i.paidAmount), 0)

  // Chi phí: 3 nguồn chuẩn tái dùng từ sync-engine (KHÔNG copy công thức)
  const costs = await calcProjectActualCosts(projectId)

  // costOther: Budget.actual các category khác (OVERHEAD, EQUIPMENT, SUBCONTRACT, ...)
  const budgetRows = await prisma.budget.findMany({
    where: { projectId, month: null, year: null },
    select: { category: true, planned: true, actual: true, committed: true },
  })
  const costOther = budgetRows
    .filter(b => !CORE_COST_CATEGORIES.includes(b.category))
    .reduce((s, b) => s + Number(b.actual), 0)

  const totalCost = costs.material + costs.labor + costs.service + costOther
  const profit = revenueContract - totalCost
  const marginPct = revenueContract > 0 ? round2((profit / revenueContract) * 100) : 0

  const numbers: SettlementNumbers = {
    revenueContract: round2(revenueContract),
    revenueInvoiced: round2(revenueInvoiced),
    revenueCollected: round2(revenueCollected),
    costMaterial: round2(costs.material),
    costLabor: round2(costs.labor),
    costService: round2(costs.service),
    costOther: round2(costOther),
    totalCost: round2(totalCost),
    profit: round2(profit),
    marginPct,
  }

  return {
    numbers,
    budgets: budgetRows.map(b => ({
      category: b.category,
      planned: Number(b.planned),
      actual: Number(b.actual),
      committed: Number(b.committed),
    })),
    snapshot: {
      computedAt: new Date().toISOString(),
      projectCode: project.projectCode,
      sources: {
        revenue: {
          contractValue: revenueContract,
          receivableInvoiceCount: receivables.length,
          rule: 'invoiced = Σ RECEIVABLE totalAmount; collected = Σ RECEIVABLE paidAmount',
        },
        cost: {
          material: 'GRN nhập kho (StockMovement IN po_receipt/warehouse_receipt, không REV-)',
          labor: 'Khoán đã nghiệm thu (MonthlyPieceRateOutput VERIFIED)',
          service: 'Hóa đơn CHI paidAmount không gắn PO vật tư',
          other: `Budget.actual category ngoài ${CORE_COST_CATEGORIES.join('/')}`,
        },
      },
      budgets: budgetRows.map(b => ({
        category: b.category,
        planned: Number(b.planned),
        actual: Number(b.actual),
      })),
    },
  }
}

/** Convert Decimal fields → number cho response FE. */
function serializeSettlement(s: {
  id: string; projectId: string; status: string
  revenueContract: unknown; revenueInvoiced: unknown; revenueCollected: unknown
  costMaterial: unknown; costLabor: unknown; costService: unknown; costOther: unknown
  totalCost: unknown; profit: unknown; marginPct: unknown
  snapshot: unknown; notes: string | null; createdBy: string
  submittedAt: Date | null; approvedBy: string | null; approvedAt: Date | null
  createdAt: Date; updatedAt: Date
}) {
  return {
    ...s,
    revenueContract: Number(s.revenueContract),
    revenueInvoiced: Number(s.revenueInvoiced),
    revenueCollected: Number(s.revenueCollected),
    costMaterial: Number(s.costMaterial),
    costLabor: Number(s.costLabor),
    costService: Number(s.costService),
    costOther: Number(s.costOther),
    totalCost: Number(s.totalCost),
    profit: Number(s.profit),
    marginPct: Number(s.marginPct),
  }
}

async function checkProjectAccess(user: { userId: string; roleCode: string; username: string; userLevel: number; fullName: string }, projectId: string): Promise<boolean> {
  const userProjectIds = await getUserProjectIds(user)
  return userProjectIds === null || userProjectIds.includes(projectId)
}

// GET /api/finance/settlement?projectId= — settlement hiện tại + số liệu live để so
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')
    if (!projectId) return errorResponse('Thiếu projectId')

    if (!(await checkProjectAccess(user, projectId))) {
      return errorResponse('Dự án không tồn tại', 404)
    }

    const computed = await computeSettlement(projectId)
    if (!computed) return errorResponse('Dự án không tồn tại', 404)

    const settlement = await prisma.projectSettlement.findUnique({ where: { projectId } })

    return successResponse({
      settlement: settlement ? serializeSettlement(settlement) : null,
      live: computed.numbers,
      budgets: computed.budgets,
    })
  } catch (err) {
    console.error('GET /api/finance/settlement error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

const ACTIONS = ['REFRESH', 'SUBMIT', 'APPROVE', 'REJECT'] as const
type SettlementAction = (typeof ACTIONS)[number]

// POST /api/finance/settlement — { projectId, action: REFRESH | SUBMIT | APPROVE | REJECT }
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const body = await req.json().catch(() => null)
    const projectId = body?.projectId as string | undefined
    const action = body?.action as SettlementAction | undefined
    if (!projectId || !action || !ACTIONS.includes(action)) {
      return errorResponse('Thiếu projectId hoặc action không hợp lệ (REFRESH/SUBMIT/APPROVE/REJECT)')
    }

    // RBAC: REFRESH/SUBMIT = finance write; APPROVE/REJECT = chỉ BGĐ (R01)
    if (action === 'REFRESH' || action === 'SUBMIT') {
      if (!(FINANCE_WRITE_ROLES as readonly string[]).includes(user.roleCode)) {
        return forbiddenResponse('Không có quyền ghi tài chính')
      }
    } else {
      if (user.roleCode !== 'R01') {
        return forbiddenResponse('Chỉ BGĐ (R01) mới được duyệt/từ chối quyết toán')
      }
    }

    if (!(await checkProjectAccess(user, projectId))) {
      return errorResponse('Dự án không tồn tại', 404)
    }

    const existing = await prisma.projectSettlement.findUnique({ where: { projectId } })

    if (action === 'REFRESH') {
      // Không đè bản đã trình/duyệt
      if (existing && ['SUBMITTED', 'APPROVED'].includes(existing.status)) {
        return errorResponse(`Quyết toán đang ở trạng thái ${existing.status} — không thể tính lại`, 409)
      }

      const computed = await computeSettlement(projectId)
      if (!computed) return errorResponse('Dự án không tồn tại', 404)

      const data = {
        ...computed.numbers,
        status: 'DRAFT',
        snapshot: JSON.parse(JSON.stringify(computed.snapshot)),
        submittedAt: null,
        approvedBy: null,
        approvedAt: null,
      }
      const settlement = await prisma.projectSettlement.upsert({
        where: { projectId },
        create: { projectId, createdBy: user.userId, ...data },
        update: data,
      })

      await logAudit(user.userId, 'SETTLEMENT_REFRESH', 'ProjectSettlement', settlement.id,
        { projectId, ...computed.numbers }, getClientIP(req))

      return successResponse(
        { settlement: serializeSettlement(settlement), budgets: computed.budgets },
        'Đã tính lại quyết toán (DRAFT)'
      )
    }

    // SUBMIT / APPROVE / REJECT cần settlement tồn tại
    if (!existing) return errorResponse('Chưa có quyết toán — hãy Tính lại (REFRESH) trước', 404)

    if (action === 'SUBMIT') {
      if (existing.status !== 'DRAFT') {
        return errorResponse(`Chỉ trình duyệt được từ DRAFT (hiện tại: ${existing.status})`, 409)
      }
      const settlement = await prisma.projectSettlement.update({
        where: { projectId },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      })
      await logAudit(user.userId, 'SETTLEMENT_SUBMIT', 'ProjectSettlement', settlement.id, { projectId }, getClientIP(req))
      return successResponse({ settlement: serializeSettlement(settlement) }, 'Đã trình duyệt quyết toán')
    }

    // APPROVE / REJECT: chỉ từ SUBMITTED
    if (existing.status !== 'SUBMITTED') {
      return errorResponse(`Chỉ duyệt/từ chối được khi đang SUBMITTED (hiện tại: ${existing.status})`, 409)
    }

    if (action === 'APPROVE') {
      const settlement = await prisma.projectSettlement.update({
        where: { projectId },
        data: { status: 'APPROVED', approvedBy: user.userId, approvedAt: new Date() },
      })
      await logAudit(user.userId, 'SETTLEMENT_APPROVE', 'ProjectSettlement', settlement.id, { projectId }, getClientIP(req))
      return successResponse({ settlement: serializeSettlement(settlement) }, 'Đã duyệt quyết toán')
    }

    // REJECT
    const reason = typeof body?.reason === 'string' ? body.reason : undefined
    const settlement = await prisma.projectSettlement.update({
      where: { projectId },
      data: { status: 'REJECTED', ...(reason ? { notes: reason } : {}) },
    })
    await logAudit(user.userId, 'SETTLEMENT_REJECT', 'ProjectSettlement', settlement.id, { projectId, reason }, getClientIP(req))
    return successResponse({ settlement: serializeSettlement(settlement) }, 'Đã từ chối quyết toán')
  } catch (err) {
    console.error('POST /api/finance/settlement error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
