import prisma from './db'
import { KHAC_CATEGORY, WORKSHOP_STAGES, WHOLE_PROJECT_STAGES, categoriesOf } from './work-catalog'
import { ITEM_CA_DU_AN } from './hang-muc'
import { SUBCONTRACT_TEAM_CODE } from './material-request-constants'

export interface PriceBookRow { item: string; teamCode: string; stageCode: string; categoryCode: string }

/**
 * "Sổ đơn giá" của một bản APL: MỌI hạng mục × công đoạn CỐ ĐỊNH của từng xưởng × chủng loại
 * (theo danh mục) + 1 dòng "Khác"/hạng mục. Đây là danh sách ô ĐƯỢC PHÉP đặt đơn giá — dùng
 * chung cho export (in ra để điền) và cho import/nhập tay (validate). Ngoài ra vẫn cho phép
 * giá "cả lệnh" ở những hạng mục có lệnh nguyên khối (không chia công đoạn), để không hỏng dữ
 * liệu cũ.
 */
export async function priceBookRows(importId: string): Promise<PriceBookRow[]> {
  const items = (await prisma.aplLine.findMany({
    where: { importId, isAssembly: true }, distinct: ['item'], select: { item: true },
  })).map(r => r.item || '')

  const wos = await prisma.workOrder.findMany({
    where: { aplImportId: importId, status: { not: 'CANCELLED' } },
    select: { aplItem: true, teamCode: true, department: { select: { code: true } }, stages: { select: { stageCode: true, categoryCode: true } } },
  })
  // Hạng mục có lệnh nguyên khối theo xưởng (để giữ ô "cả lệnh").
  const wholeOrderByTeam = new Map<string, Set<string>>()
  for (const w of wos) {
    if (w.stages.length > 0) continue
    const team = w.department?.code || w.teamCode || ''
    const set = wholeOrderByTeam.get(team) || new Set<string>()
    set.add(w.aplItem || ''); wholeOrderByTeam.set(team, set)
  }

  const rows: PriceBookRow[] = []
  // Xưởng giao THEO HẠNG MỤC: mỗi hạng mục × công đoạn của xưởng × chủng loại.
  for (const [teamCode, stages] of Object.entries(WORKSHOP_STAGES)) {
    for (const item of items) {
      for (const sc of stages) {
        const cats = categoriesOf(sc)
        if (cats.length === 0) rows.push({ item, teamCode, stageCode: sc, categoryCode: '' })
        else for (const c of cats) rows.push({ item, teamCode, stageCode: sc, categoryCode: c.code })
      }
      rows.push({ item, teamCode, stageCode: '', categoryCode: KHAC_CATEGORY }) // "Khác" của hạng mục
      if (wholeOrderByTeam.get(teamCode)?.has(item)) rows.push({ item, teamCode, stageCode: '', categoryCode: '' })
    }
  }
  // Xưởng giao CẢ DỰ ÁN (XPC/XHT): một "hạng mục" duy nhất = ITEM_CA_DU_AN, các công đoạn của
  // xưởng đó × chủng loại + "Khác". Không theo từng hạng mục.
  for (const [teamCode, stages] of Object.entries(WHOLE_PROJECT_STAGES)) {
    for (const sc of stages) {
      const cats = categoriesOf(sc)
      if (cats.length === 0) rows.push({ item: ITEM_CA_DU_AN, teamCode, stageCode: sc, categoryCode: '' })
      else for (const c of cats) rows.push({ item: ITEM_CA_DU_AN, teamCode, stageCode: sc, categoryCode: c.code })
    }
    rows.push({ item: ITEM_CA_DU_AN, teamCode, stageCode: '', categoryCode: KHAC_CATEGORY })
  }
  // THẦU PHỤ (giao ra ngoài, PM lo giá): công đoạn/chủng loại KHÔNG cố định — lấy theo phần
  // việc ĐÃ GIAO thầu phụ (per hạng mục) + "Khác" mỗi hạng mục.
  const subItems = new Map<string, Set<string>>() // item -> Set("stage::cat")
  for (const w of wos) {
    if ((w.teamCode || '').toUpperCase() !== SUBCONTRACT_TEAM_CODE) continue
    const item = w.aplItem || ''
    const set = subItems.get(item) || new Set<string>()
    for (const st of w.stages) set.add(`${st.stageCode}::${st.categoryCode || ''}`)
    subItems.set(item, set)
  }
  for (const [item, keys] of subItems) {
    for (const k of keys) {
      const [sc, cc] = k.split('::')
      rows.push({ item, teamCode: SUBCONTRACT_TEAM_CODE, stageCode: sc, categoryCode: cc })
    }
    rows.push({ item, teamCode: SUBCONTRACT_TEAM_CODE, stageCode: '', categoryCode: KHAC_CATEGORY })
  }
  return rows
}

// Lưu đơn giá khoán của xưởng theo CHỦNG LOẠI — dùng chung cho nhập trên màn (POST) và
// nhập từ file Excel (import). Chỉ nhận đúng (item × xưởng × công đoạn × chủng loại) có lệnh
// SX thật; giá "Khác" (categoryCode='KHAC') cho phép với mọi (item × xưởng) có lệnh. Mỗi xưởng
// chỉ ghi phần việc CỦA MÌNH (trừ Admin).

export interface ShopPriceEntry {
  item: string; teamCode: string; stageCode: string; categoryCode: string
  unitPrice: number | null | undefined
}
export interface SaveShopPriceResult { saved: number; cleared: number; rejectedOtherShop: number }

const parsePrice = (raw: unknown): number | null | undefined => {
  if (raw === null || raw === undefined || raw === '') return null // null = xoá
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : undefined // undefined = bỏ qua
}

export async function saveWorkshopPrices(
  importId: string,
  entries: ShopPriceEntry[],
  opts: { myTeam: string; isAdmin: boolean; userId: string },
): Promise<SaveShopPriceResult> {
  // Ô được phép đặt giá = sổ đơn giá (mọi hạng mục × công đoạn cố định của xưởng × chủng loại
  // + "Khác" + "cả lệnh" cho lệnh nguyên khối). Ngoài ra vẫn nhận đúng công đoạn/chủng loại ĐÃ
  // GIAO thực tế (kể cả chủng loại "Khác" tự nhập ngoài danh mục) để không kẹt dữ liệu đã có.
  const book = await priceBookRows(importId)
  const known = new Set<string>(book.map(b => `${b.item}::${b.teamCode}::${b.stageCode}::${b.categoryCode}`))
  const assigned = await prisma.workOrder.findMany({
    where: { aplImportId: importId, status: { not: 'CANCELLED' } },
    select: { aplItem: true, teamCode: true, stagesDisjoint: true, department: { select: { code: true } }, stages: { select: { stageCode: true, categoryCode: true } } },
  })
  for (const w of assigned) {
    const team = w.department?.code || w.teamCode || ''
    // Lệnh cả-dự-án (stagesDisjoint) khớp giá dưới nhóm "(cả dự án)", không theo hạng mục.
    const itemKey = w.stagesDisjoint ? ITEM_CA_DU_AN : (w.aplItem || '')
    for (const st of w.stages) known.add(`${itemKey}::${team}::${st.stageCode}::${st.categoryCode || ''}`)
  }

  let saved = 0, cleared = 0, rejectedOtherShop = 0
  for (const p of entries) {
    const item = String(p.item ?? '')
    const teamCode = String(p.teamCode ?? '')
    const stageCode = String(p.stageCode ?? '')
    const categoryCode = String(p.categoryCode ?? '')
    if (!teamCode) continue
    if (!opts.isAdmin && teamCode !== opts.myTeam) { rejectedOtherShop++; continue }
    if (!known.has(`${item}::${teamCode}::${stageCode}::${categoryCode}`)) continue
    const price = parsePrice(p.unitPrice)
    if (price === undefined) continue
    if (price === null) {
      const del = await prisma.aplItemWorkshopPrice.deleteMany({ where: { importId, item, teamCode, stageCode, categoryCode } })
      cleared += del.count
      continue
    }
    await prisma.aplItemWorkshopPrice.upsert({
      where: { importId_item_teamCode_stageCode_categoryCode: { importId, item, teamCode, stageCode, categoryCode } },
      create: { importId, item, teamCode, stageCode, categoryCode, unitPrice: price, updatedBy: opts.userId },
      update: { unitPrice: price, updatedBy: opts.userId },
    })
    saved++
  }
  return { saved, cleared, rejectedOtherShop }
}
