import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { priceBookRows } from '@/lib/apl-pricing-save'
import { findStage, categoriesOf, KHAC_CATEGORY, isWholeProjectWorkshop, stagesOfWorkshop, WORK_STAGES } from '@/lib/work-catalog'
import { ITEM_CA_DU_AN, tenHangMuc } from '@/lib/hang-muc'
import { SUBCONTRACT_TEAM_CODE } from '@/lib/material-request-constants'
import { PRODUCTION_WORKSHOPS } from '@/lib/org-map'

export const dynamic = 'force-dynamic'

// GET /api/hr/apl-pricing/price-book?projectId=
// TRẢ VỀ TOÀN BỘ đơn giá các xưởng đã nhập, gom THEO XƯỞNG → công đoạn/chủng loại. Đây là chỗ
// KTKT rà soát ĐƠN GIÁ (không nhân KL hoàn thành) — độc lập với việc đã phân giao/nghiệm thu.
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  if (!projectId) return errorResponse('Thiếu projectId', 400)

  const imp = await prisma.aplImport.findFirst({
    where: { projectId }, orderBy: { createdAt: 'desc' }, select: { id: true, fileName: true },
  })
  if (!imp) return successResponse({ apl: null, workshops: [], totalFilled: 0, totalCells: 0 })

  // "Sổ đơn giá" = mọi ô ĐƯỢC PHÉP đặt giá của từng xưởng (mọi hạng mục × công đoạn × chủng
  // loại + "Khác"). Không phụ thuộc đã phân giao lệnh hay chưa.
  const book = await priceBookRows(imp.id)
  // Đơn giá đã nhập.
  const prices = await prisma.aplItemWorkshopPrice.findMany({
    where: { importId: imp.id },
    select: { item: true, teamCode: true, stageCode: true, categoryCode: true, unitPrice: true },
  })
  const priceOf = new Map(prices.map(p => [`${p.item}::${p.teamCode}::${p.stageCode}::${p.categoryCode}`, Number(p.unitPrice)]))

  // Gom ô: bắt đầu từ sổ; thêm bất kỳ giá nào đã nhập mà KHÔNG có trong sổ (chủng loại lạ tự
  // nhập khi phân giao) để KHÔNG giấu đơn giá nào.
  type Cell = { item: string; teamCode: string; stageCode: string; categoryCode: string }
  const seen = new Set<string>()
  const cells: Cell[] = []
  const addCell = (c: Cell) => {
    const k = `${c.item}::${c.teamCode}::${c.stageCode}::${c.categoryCode}`
    if (seen.has(k)) return
    seen.add(k); cells.push(c)
  }
  for (const b of book) addCell(b)
  for (const p of prices) addCell({ item: p.item, teamCode: p.teamCode, stageCode: p.stageCode, categoryCode: p.categoryCode })

  const wsName = (code: string) => {
    if (code === SUBCONTRACT_TEAM_CODE) return 'Thầu phụ'
    return PRODUCTION_WORKSHOPS.find(w => w.code === code)?.name || code
  }
  const stageLabel = (sc: string, cc: string): string => {
    if (!sc && cc === KHAC_CATEGORY) return '(Khác)'
    if (!sc) return '(cả lệnh)'
    const s = findStage(sc)
    return s ? `${sc} · ${s.label}` : sc
  }
  const catLabel = (sc: string, cc: string): string => {
    if (cc === KHAC_CATEGORY) return 'Khác — chủng loại ngoài danh sách'
    if (!sc && !cc) return '(đơn giá cho cả lệnh)'
    if (!cc) return '(không có chủng loại)'
    return categoriesOf(sc).find(c => c.code === cc)?.label || cc
  }
  const itemLabel = (item: string, teamCode: string): string => {
    // ITEM_CA_DU_AN dùng chung cho XPC/XHT — nhãn phải theo XƯỞNG, không phải "Pha cắt" cứng.
    if (item === ITEM_CA_DU_AN) return `(Cả dự án — ${wsName(teamCode)})`
    return tenHangMuc(item)
  }

  // Xếp thứ tự công đoạn theo danh mục để bảng đọc mượt.
  const stageOrder = new Map(findStageOrder())
  const catOrderOf = (sc: string, cc: string): number => {
    if (cc === KHAC_CATEGORY) return 9999 // "Khác" luôn cuối
    const cats = categoriesOf(sc)
    const i = cats.findIndex(c => c.code === cc)
    return i < 0 ? 9000 : i
  }

  // Gom theo xưởng.
  const byTeam = new Map<string, Cell[]>()
  for (const c of cells) { const arr = byTeam.get(c.teamCode) || []; arr.push(c); byTeam.set(c.teamCode, arr) }

  const workshops = [...byTeam.entries()].map(([teamCode, list]) => {
    const rows = list.map(c => {
      const price = priceOf.get(`${c.item}::${c.teamCode}::${c.stageCode}::${c.categoryCode}`)
      return {
        item: c.item,
        itemLabel: itemLabel(c.item, teamCode),
        stageCode: c.stageCode,
        stageName: stageLabel(c.stageCode, c.categoryCode),
        categoryCode: c.categoryCode,
        categoryName: catLabel(c.stageCode, c.categoryCode),
        unitPrice: price ?? null,
      }
    }).sort((a, b) =>
      (stageOrder.get(a.stageCode) ?? 8000) - (stageOrder.get(b.stageCode) ?? 8000) ||
      a.stageCode.localeCompare(b.stageCode) ||
      catOrderOf(a.stageCode, a.categoryCode) - catOrderOf(b.stageCode, b.categoryCode) ||
      a.categoryCode.localeCompare(b.categoryCode) ||
      a.item.localeCompare(b.item),
    )
    const filled = rows.filter(r => r.unitPrice !== null).length
    const kind = teamCode === SUBCONTRACT_TEAM_CODE ? 'subcontract'
      : isWholeProjectWorkshop(teamCode) ? 'whole-project'
      : stagesOfWorkshop(teamCode).length > 0 ? 'per-item' : 'other'
    return { teamCode, teamName: wsName(teamCode), kind, filled, total: rows.length, rows }
  }).sort((a, b) => teamRank(a.teamCode) - teamRank(b.teamCode) || a.teamCode.localeCompare(b.teamCode))

  const totalFilled = workshops.reduce((s, w) => s + w.filled, 0)
  const totalCells = workshops.reduce((s, w) => s + w.total, 0)

  return successResponse({
    apl: { fileName: imp.fileName },
    workshops, totalFilled, totalCells,
  })
}

// Thứ tự công đoạn = thứ tự trong WORK_STAGES (đọc một lần).
function findStageOrder(): [string, number][] {
  return WORK_STAGES.map((s, i) => [s.code, i])
}
// Xưởng theo hạng mục trước, cả-dự-án, rồi thầu phụ.
function teamRank(teamCode: string): number {
  if (teamCode === SUBCONTRACT_TEAM_CODE) return 3
  if (isWholeProjectWorkshop(teamCode)) return 2
  if (stagesOfWorkshop(teamCode).length > 0) return 1
  return 4
}
