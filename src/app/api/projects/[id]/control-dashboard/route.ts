import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'
import { STAGE_WEIGHTS, STAGES_ORDERED } from '@/lib/production-weights'

const DASHBOARD_ROLES = ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R10']

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, DASHBOARD_ROLES)) {
    return errorResponse('Không có quyền xem bảng điều khiển', 403)
  }

  const pResult = validateParams(await params, idParamSchema)
  if (!pResult.success) return pResult.response
  const projectId = pResult.data.id

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, projectCode: true, projectName: true, contractValue: true, currency: true },
  })
  if (!project) return errorResponse('Dự án không tồn tại', 404)

  const [baseline, budgets, bomData, woData, ecos, poData, cashData] = await Promise.all([
    // ① KẾ HOẠCH — baseline đông cứng
    prisma.projectBaseline.findFirst({
      where: { projectId, isActive: true },
      orderBy: { version: 'desc' },
    }),

    // Chi phí — budgets
    prisma.budget.findMany({
      where: { projectId },
      select: { category: true, planned: true, actual: true, committed: true, forecast: true },
    }),

    // ② HIỆN HÀNH — BOM ACTIVE lines
    loadBomCurrentData(projectId),

    // ③ THỰC HIỆN — WorkOrders + JobCards
    loadProductionData(projectId),

    // Thay đổi — ECOs
    prisma.engineeringChangeOrder.findMany({
      where: { projectId },
      select: {
        id: true, ecoCode: true, title: true, status: true,
        source: true, costBearer: true, impactCost: true, ncrId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),

    // PO committed
    prisma.purchaseOrder.findMany({
      where: { projectId, status: { in: ['APPROVED', 'SENT', 'PAID', 'PARTIAL_RECEIVED', 'RECEIVED'] } },
      select: { totalValue: true, status: true },
    }),

    // Cash (Σ Payments via invoices linked to this project's POs)
    loadCashData(projectId),
  ])

  // ── ① KẾ HOẠCH ──
  const baselineSnapshot = baseline?.snapshot as Record<string, unknown> | null
  const baselineBudgets = (baselineSnapshot?.budgets as Array<{ category: string; planned: number }>) || []
  const baselineTotalPlanned = baselineBudgets.reduce((s, b) => s + (b.planned || 0), 0)

  // ── ② HIỆN HÀNH ──
  // bomData already computed

  // ── ③ THỰC HIỆN ──
  // woData already computed

  // ── Chi phí ──
  const budgetSummary = {
    planned: budgets.reduce((s, b) => s + Number(b.planned), 0),
    actual: budgets.reduce((s, b) => s + Number(b.actual), 0),
    committed: budgets.reduce((s, b) => s + Number(b.committed), 0),
    forecast: budgets.reduce((s, b) => s + Number(b.forecast), 0),
    byCategory: budgets.map(b => ({
      category: b.category,
      planned: Number(b.planned),
      actual: Number(b.actual),
      committed: Number(b.committed),
      forecast: Number(b.forecast),
    })),
  }

  const poCommitted = poData.reduce((s, p) => s + Number(p.totalValue || 0), 0)
  const poCount = poData.length
  const contractValue = Number(project.contractValue || 0)

  // ── Thay đổi — ECO ──
  const ecoBySource: Record<string, { count: number; totalDeltaCost: number }> = {}
  const ecoByCostBearer: Record<string, { count: number; totalDeltaCost: number }> = {}

  for (const eco of ecos) {
    const src = eco.source || 'DESIGN'
    const cb = eco.costBearer || 'INTERNAL'
    const cost = Number(eco.impactCost || 0)

    if (!ecoBySource[src]) ecoBySource[src] = { count: 0, totalDeltaCost: 0 }
    ecoBySource[src].count++
    ecoBySource[src].totalDeltaCost += cost

    if (!ecoByCostBearer[cb]) ecoByCostBearer[cb] = { count: 0, totalDeltaCost: 0 }
    ecoByCostBearer[cb].count++
    ecoByCostBearer[cb].totalDeltaCost += cost
  }

  return successResponse({
    project: {
      id: project.id,
      projectCode: project.projectCode,
      projectName: project.projectName,
      contractValue: Number(project.contractValue || 0),
      currency: project.currency,
    },

    // KHỐI 1: Khối lượng
    volume: {
      baseline: {
        tons: baselineSnapshot ? extractBaselineTons(baselineSnapshot) : null,
        label: baseline?.label || null,
        frozenAt: baseline?.frozenAt || null,
      },
      current: {
        bomTons: bomData.totalTons,
        bomPieceMarks: bomData.pieceMarkCount,
        versionNo: bomData.activeVersionNo,
      },
      actual: {
        completedTons: woData.completedTons,
        earnedTons: woData.earnedTons,
        completedPct: woData.completedPct,
        earnedPct: woData.earnedPct,
        completedPieceMarks: woData.completedPieceMarks,
        earnedPieceMarks: woData.earnedPieceMarks,
        totalPieceMarks: woData.totalPieceMarks,
      },
      variance: {
        bomVsBaseline: bomData.totalTons != null && baselineSnapshot
          ? round2(bomData.totalTons - extractBaselineTons(baselineSnapshot))
          : null,
      },
    },

    // KHỐI 2: Chi phí
    cost: {
      baselinePlanned: baselineTotalPlanned || null,
      currentPlanned: budgetSummary.planned,
      committed: poCommitted,
      actual: budgetSummary.actual,
      cash: cashData.totalPaid,
      forecast: budgetSummary.forecast || null,
      profitLoss: contractValue > 0 ? round2(contractValue - poCommitted) : null,
      poCount,
      byCategory: budgetSummary.byCategory,
    },

    // KHỐI 3: Thay đổi (ECO)
    changes: {
      totalEcos: ecos.length,
      bySource: ecoBySource,
      byCostBearer: ecoByCostBearer,
      recentEcos: ecos.slice(0, 10).map(e => ({
        ecoCode: e.ecoCode,
        title: e.title,
        status: e.status,
        source: e.source,
        costBearer: e.costBearer,
        impactCost: Number(e.impactCost || 0),
        hasNcr: !!e.ncrId,
        createdAt: e.createdAt,
      })),
    },

    // KHỐI 4: Công đoạn / tổ
    stages: woData.stages,
  })
}

// ── Helpers ──

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function extractBaselineTons(snapshot: Record<string, unknown>): number {
  const budgets = snapshot.budgets as Array<{ category: string; planned: number }> | undefined
  if (!budgets) return 0
  const vtc = budgets.find(b => b.category === 'VTC' || b.category === 'MATERIAL' || b.category === 'VẬT TƯ CHÍNH')
  return vtc ? vtc.planned : 0
}

type BomCurrent = {
  totalTons: number
  pieceMarkCount: number
  activeVersionNo: number | null
  source: 'bom-table' | 'task-resultData' | 'none'
}

/**
 * HIỆN HÀNH — tổng khối lượng BOM của dự án.
 *
 * Nguồn ưu tiên 1: BOM đã structured (BillOfMaterial → BomVersion ACTIVE → BomItem).
 * Nguồn ưu tiên 2 (fallback): BOM còn nằm trong Task.resultData của bước P2.1
 *   (key `bomPrItems`, double-encoded JSON). Rất nhiều dự án thật CHƯA được
 *   materialize sang bảng BomVersion/BomItem → nếu chỉ đọc bảng silo thì
 *   dashboard hiển thị 0 tấn dù dự án có BOM 500+ dòng trong task.
 *   Đây CHỈ là phía ĐỌC (report) — không tạo bản ghi, không sync.
 */
async function loadBomCurrentData(projectId: string): Promise<BomCurrent> {
  // ── Ưu tiên 1: bảng BOM structured ──
  const bom = await prisma.billOfMaterial.findFirst({
    where: { projectId },
    select: { id: true },
  })
  if (bom) {
    const activeVersion = await prisma.bomVersion.findFirst({
      where: { bomId: bom.id, status: 'ACTIVE' },
      select: { id: true, versionNo: true },
    })
    if (activeVersion) {
      const lines = await prisma.bomItem.findMany({
        where: { bomVersionId: activeVersion.id, category: 'MAIN' },
        select: { quantity: true, pieceMark: true },
      })
      const totalKg = lines.reduce((s, l) => s + Number(l.quantity), 0)
      if (totalKg > 0) {
        const pieceMarks = new Set(lines.map(l => l.pieceMark).filter(Boolean))
        return {
          totalTons: round2(totalKg / 1000),
          pieceMarkCount: pieceMarks.size,
          activeVersionNo: activeVersion.versionNo,
          source: 'bom-table',
        }
      }
    }
  }

  // ── Ưu tiên 2: BOM còn trong Task.resultData (bước P2.1) ──
  const fromTask = await loadBomFromTaskData(projectId)
  if (fromTask) return fromTask

  return { totalTons: 0, pieceMarkCount: 0, activeVersionNo: null, source: 'none' }
}

/** Ép về số hữu hạn (chấp nhận cả chuỗi số "1", "12,345.6"); không hợp lệ → 0. */
function toKg(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const s = v.trim()
    if (s === '') return 0
    // xoá phân cách nghìn kiểu 12,345.6 (không xoá dấu phẩy thập phân "1,5")
    const cleaned = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) ? s.replace(/,/g, '') : s
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/**
 * Đọc BOM từ resultData bước P2.1 (VT chính). Trả null nếu không có dữ liệu dùng được.
 * bomPrItems thường DOUBLE-ENCODED (chuỗi chứa JSON) → phải JSON.parse.
 * Khối lượng mỗi dòng: ưu tiên `weight` (KL đặt hiện tại, kg) → `netWeight` (KL net BOM)
 *   → `unitWeight * quantity`. Khớp cách BomPrUploadUI tính "tổng KL".
 */
async function loadBomFromTaskData(projectId: string): Promise<BomCurrent | null> {
  const p21 = await prisma.task.findFirst({
    where: { projectId, taskType: 'P2.1' },
    select: { resultData: true },
    orderBy: { completedAt: 'desc' },
  })
  const rd = p21?.resultData as Record<string, unknown> | null
  if (!rd) return null

  const raw = rd.bomPrItems
  let items: unknown[] = []
  if (Array.isArray(raw)) {
    items = raw
  } else if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const parsed = JSON.parse(raw)
      items = Array.isArray(parsed) ? parsed : []
    } catch {
      return null // JSON hỏng → không đoán số, coi như không có
    }
  }
  if (items.length === 0) return null

  let totalKg = 0
  let lineCount = 0
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const weight = toKg(o.weight)
    const netWeight = toKg(o.netWeight)
    const unitWeight = toKg(o.unitWeight)
    const quantity = toKg(o.quantity)
    const kg = weight > 0
      ? weight
      : netWeight > 0
        ? netWeight
        : unitWeight > 0
          ? unitWeight * quantity
          : 0
    if (kg <= 0) continue
    totalKg += kg
    lineCount++
  }
  if (totalKg <= 0) return null

  return {
    totalTons: round2(totalKg / 1000),
    // BOM mua VT chính không có "piece mark" riêng → dùng số DÒNG vật tư làm thước đo quy mô.
    pieceMarkCount: lineCount,
    activeVersionNo: null,
    source: 'task-resultData',
  }
}

async function loadProductionData(projectId: string) {
  const workOrders = await prisma.workOrder.findMany({
    where: { projectId },
    select: {
      id: true, pieceMark: true, status: true,
      plannedWeight: true, completedQty: true, earnedQty: true,
    },
  })

  const totalPieceMarks = workOrders.filter(w => w.pieceMark).length
  const completedPieceMarks = workOrders.filter(w => w.pieceMark && w.status === 'COMPLETED').length
  const earnedPieceMarks = workOrders.filter(w => w.pieceMark && (Number(w.earnedQty) || 0) > 0).length

  const totalKg = workOrders.reduce((s, w) => s + (Number(w.plannedWeight) || 0), 0)
  const completedKg = workOrders.reduce((s, w) => s + (Number(w.completedQty) || 0), 0)
  const earnedKg = workOrders.reduce((s, w) => s + (Number(w.earnedQty) || 0), 0)

  const totalTons = totalKg / 1000

  const woIds = workOrders.map(w => w.id)
  const jobCards = woIds.length > 0 ? await prisma.jobCard.findMany({
    where: { workOrderId: { in: woIds }, status: { not: 'CANCELLED' } },
    select: { workType: true, actualQty: true, status: true },
  }) : []

  const stages = STAGES_ORDERED.map(stage => {
    const cards = jobCards.filter(jc => jc.workType === stage)
    const completed = cards.filter(jc => jc.status === 'COMPLETED')
    return {
      stage,
      weight: STAGE_WEIGHTS[stage] || 0,
      totalCards: cards.length,
      completedCards: completed.length,
      pct: cards.length > 0 ? Math.round((completed.length / cards.length) * 100) : 0,
    }
  })

  return {
    completedTons: round2(completedKg / 1000),
    earnedTons: round2(earnedKg / 1000),
    completedPct: totalTons > 0 ? Math.round((completedKg / totalKg) * 100) : 0,
    earnedPct: totalTons > 0 ? Math.round((earnedKg / totalKg) * 100) : 0,
    totalPieceMarks,
    completedPieceMarks,
    earnedPieceMarks,
    stages,
  }
}

async function loadCashData(projectId: string) {
  const result = await prisma.payment.aggregate({
    where: { invoice: { projectId } },
    _sum: { amount: true },
  })
  return { totalPaid: Number(result._sum?.amount || 0) }
}
