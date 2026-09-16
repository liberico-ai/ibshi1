import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit } from '@/lib/auth'
import { saveWorkshopPrices, type ShopPriceEntry } from '@/lib/apl-pricing-save'
import { computePricingTotals } from '@/lib/apl-pricing'
import { isWholeProjectWorkshop } from '@/lib/work-catalog'
import { ITEM_CA_DU_AN } from '@/lib/hang-muc'
import { SUBCONTRACT_TEAM_CODE } from '@/lib/material-request-constants'
import ExcelJS from 'exceljs'

export const dynamic = 'force-dynamic'

const SHOP_ROLES = ['R06', 'R06a', 'R06b']
// Nhập HỘ mọi xưởng (phải chọn xưởng): BGĐ, KTKH, Admin. Xưởng thì chỉ nhập phần mình.
const ON_BEHALF_ROLES = ['R01', 'R03', 'R03a', 'R10']
const PM_ROLES = ['R02', 'R02a'] // PM chỉ nhập phần THẦU PHỤ
const MAX_FILE = 10 * 1024 * 1024

// POST /api/hr/apl-pricing/import (multipart: file, projectId, teamCode?)
// Đọc file "Đơn giá giao khoán" xưởng đã điền → upsert đơn giá theo chủng loại (dùng chung
// helper với nhập tay). Ô Đơn giá để trống = KHÔNG đụng tới (không xoá) — chỉ ghi ô có số.
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  const isShop = SHOP_ROLES.includes(user.roleCode)
  const onBehalf = ON_BEHALF_ROLES.includes(user.roleCode) // BGĐ/KTKH/Admin — chọn xưởng để nhập hộ
  const isPm = PM_ROLES.includes(user.roleCode) // PM — chỉ nhập phần Thầu phụ
  if (!isShop && !onBehalf && !isPm) return errorResponse('Chỉ Xưởng, BGĐ/KTKH/Admin, hoặc PM (Thầu phụ) được nhập đơn giá từ file', 403)

  const fd = await req.formData()
  const file = fd.get('file') as File | null
  const projectId = String(fd.get('projectId') || '')
  let teamCode = String(fd.get('teamCode') || '').trim()
  if (!projectId) return errorResponse('Thiếu projectId', 400)
  if (!file) return errorResponse('Chưa chọn file', 400)
  if (file.size > MAX_FILE) return errorResponse('File quá lớn (tối đa 10MB)', 400)

  // Xưởng: ép về xưởng mình. BGĐ/KTKH/Admin: lấy theo tham số (đã chọn xưởng).
  const me = await prisma.user.findUnique({ where: { id: user.userId }, select: { department: { select: { code: true } } } })
  const myTeam = me?.department?.code || ''
  if (isShop) teamCode = myTeam
  if (!teamCode) return errorResponse('Chọn xưởng cần nhập đơn giá', 400)
  // PM chỉ nhập được phần THẦU PHỤ.
  if (isPm && !onBehalf && teamCode.toUpperCase() !== SUBCONTRACT_TEAM_CODE) {
    return errorResponse('PM chỉ nhập được đơn giá của phần Thầu phụ', 403)
  }

  const imp = await prisma.aplImport.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' }, select: { id: true } })
  if (!imp) return errorResponse('Dự án chưa có bảng APL', 404)
  const existing = await prisma.aplPricing.findUnique({ where: { importId: imp.id } })
  if (existing?.status === 'COMPLETED') return errorResponse('Bảng đơn giá đã chốt — không sửa được nữa', 400)
  // CHẶN: Tổng giá trị giao khoán phải được BGĐ duyệt thì mới nhập đơn giá.
  if (existing?.budgetStatus !== 'APPROVED') return errorResponse('Chờ BGĐ duyệt Tổng giá trị giao khoán rồi mới nhập được đơn giá', 403)

  // ── Đọc file ──
  let wb: ExcelJS.Workbook
  try {
    wb = new ExcelJS.Workbook()
    // exceljs khai kiểu Buffer riêng — ép any để khớp Buffer<ArrayBuffer> của Node mới.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as any)
  } catch {
    return errorResponse('File không đọc được (phải là .xlsx xuất từ hệ thống)', 400)
  }
  const ws = wb.worksheets[0]
  if (!ws) return errorResponse('File rỗng', 400)

  // Cột: 1 STT · 2 Hạng mục/item · 3 Mã CĐ · 4 Công đoạn · 5 Mã CL · 6 Chủng loại · 7 Đơn giá.
  // Ô "Hạng mục" gộp dọc → chỉ dòng đầu khối có giá trị, phải carry-forward.
  const entries: ShopPriceEntry[] = []
  let curItem = ''
  let rowsRead = 0
  const cellStr = (v: ExcelJS.CellValue): string => {
    if (v === null || v === undefined) return ''
    if (typeof v === 'object' && 'result' in v) return String((v as { result: unknown }).result ?? '')
    if (typeof v === 'object' && 'text' in v) return String((v as { text: unknown }).text ?? '')
    return String(v)
  }
  const cellNum = (v: ExcelJS.CellValue): number | null => {
    if (v === null || v === undefined || v === '') return null
    const n = typeof v === 'object' && 'result' in v ? Number((v as { result: unknown }).result) : Number(v)
    return Number.isFinite(n) ? n : null
  }
  ws.eachRow((row, n) => {
    if (n < 6) return // bỏ tiêu đề + đầu bảng
    const itemCell = cellStr(row.getCell(2).value).trim()
    if (itemCell) curItem = itemCell === '(không có item)' ? '' : itemCell
    const stageCode = cellStr(row.getCell(3).value).trim()
    const categoryCode = cellStr(row.getCell(5).value).trim()
    const price = cellNum(row.getCell(7).value)
    // Chỉ ghi ô CÓ SỐ (>=0). Ô trống = không đụng tới (không xoá) khi import.
    if (price === null || !(price >= 0)) return
    // '(cả lệnh)' là stageCode nhãn — chuẩn hoá về '' (lệnh nguyên khối).
    const sc = stageCode === '(cả lệnh)' ? '' : stageCode
    // Xưởng giao cả dự án (XPC/XHT): mọi dòng thuộc "hạng mục" duy nhất ITEM_CA_DU_AN.
    const itemVal = isWholeProjectWorkshop(teamCode) ? ITEM_CA_DU_AN : curItem
    entries.push({ item: itemVal, teamCode, stageCode: sc, categoryCode, unitPrice: price })
    rowsRead++
  })

  if (entries.length === 0) return errorResponse('File chưa điền đơn giá nào (cột "Đơn giá" trống hết)', 400)
  if (entries.length > 5000) return errorResponse('File quá nhiều dòng (tối đa 5000)', 400)

  // onBehalf (BGĐ/KTKH/Admin) hoặc PM (thầu phụ) đã chọn xưởng → ghi cho xưởng đó (bỏ chặn "đúng xưởng mình").
  const res = await saveWorkshopPrices(imp.id, entries, { myTeam, isAdmin: onBehalf || isPm, userId: user.userId })
  await prisma.aplPricing.upsert({ where: { importId: imp.id }, create: { importId: imp.id, status: 'DRAFT' }, update: {} })
  const totals = await computePricingTotals(imp.id)
  await logAudit(user.userId, 'IMPORT', 'AplPricing', imp.id, { teamCode, rowsRead, ...res, totalAmount: totals.totalAmount })

  return successResponse({ ...res, rowsRead, totals },
    `Đã nhập ${res.saved} đơn giá cho xưởng ${teamCode}${res.rejectedOtherShop ? ` — bỏ ${res.rejectedOtherShop} dòng của xưởng khác` : ''}`)
}
