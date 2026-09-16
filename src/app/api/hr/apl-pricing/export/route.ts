import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { findStage, categoriesOf, KHAC_CATEGORY, stagesOfWorkshop, isWholeProjectWorkshop } from '@/lib/work-catalog'
import { priceBookRows } from '@/lib/apl-pricing-save'
import { ITEM_CA_DU_AN } from '@/lib/hang-muc'
import { SUBCONTRACT_TEAM_CODE } from '@/lib/material-request-constants'
import { PRODUCTION_WORKSHOPS } from '@/lib/org-map'
import ExcelJS from 'exceljs'

export const dynamic = 'force-dynamic'

// Vai được xuất: Xưởng (chỉ xưởng mình) + KTKH/BGĐ/Admin (xưởng bất kỳ) + PM (CHỈ thầu phụ).
const SHOP_ROLES = ['R06', 'R06a', 'R06b']
const ALL_SHOP_ROLES = ['R01', 'R03', 'R03a', 'R10']
const PM_ROLES = ['R02', 'R02a']
const wsName = (code: string) => PRODUCTION_WORKSHOPS.find(w => w.code === code)?.name || code

// GET /api/hr/apl-pricing/export?projectId=&teamCode=
// Xuất file Excel đơn giá khoán CHỈ gồm công đoạn × chủng loại ĐÃ GIAO cho xưởng đó, mỗi hạng
// mục kèm 1 dòng "Khác" để nhập giá cho chủng loại lạ. Xưởng điền cột "Đơn giá" rồi import lại.
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  const isShop = SHOP_ROLES.includes(user.roleCode)
  const isAll = ALL_SHOP_ROLES.includes(user.roleCode)
  const isPm = PM_ROLES.includes(user.roleCode)
  if (!isShop && !isAll && !isPm) return errorResponse('Không có quyền xuất file đơn giá khoán', 403)

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  if (!projectId) return errorResponse('Thiếu projectId', 400)

  // Xưởng của người xuất. Xưởng thường → ép về xưởng mình; vai quản lý → lấy theo tham số.
  let teamCode = (url.searchParams.get('teamCode') || '').trim()
  if (isShop) {
    const me = await prisma.user.findUnique({ where: { id: user.userId }, select: { department: { select: { code: true } } } })
    teamCode = me?.department?.code || ''
    if (!teamCode) return errorResponse('Tài khoản chưa gán xưởng — không xác định được phần việc để xuất', 400)
  }
  if (!teamCode) return errorResponse('Chọn xưởng cần xuất file', 400)

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { projectCode: true, projectName: true } })
  const imp = await prisma.aplImport.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' }, select: { id: true, fileName: true } })
  if (!imp) return errorResponse('Dự án chưa có bảng APL', 404)
  // CHẶN: phải có Tổng giá trị giao khoán đã được BGĐ duyệt thì mới tải/nhập file đơn giá.
  const budgetPr = await prisma.aplPricing.findUnique({ where: { importId: imp.id }, select: { budgetStatus: true } })
  if (budgetPr?.budgetStatus !== 'APPROVED') {
    return errorResponse('Chờ BGĐ duyệt Tổng giá trị giao khoán rồi mới tải/nhập được file đơn giá', 403)
  }

  const isSub = teamCode.toUpperCase() === SUBCONTRACT_TEAM_CODE
  // PM chỉ được xuất file THẦU PHỤ (họ chịu trách nhiệm phần thầu phụ).
  if (isPm && !isShop && !isAll && !isSub) return errorResponse('PM chỉ xuất được file đơn giá của phần Thầu phụ', 403)
  if (stagesOfWorkshop(teamCode).length === 0 && !isWholeProjectWorkshop(teamCode) && !isSub) {
    return errorResponse(`Xưởng ${teamCode} không có công đoạn nào trong bảng công đoạn→xưởng`, 400)
  }

  // Sổ đơn giá của xưởng: MỌI hạng mục × công đoạn CỐ ĐỊNH của xưởng × chủng loại + "Khác"
  // (+ "cả lệnh" ở hạng mục có lệnh nguyên khối). Không phụ thuộc đã giao lệnh hay chưa.
  const book = (await priceBookRows(imp.id)).filter(b => b.teamCode === teamCode)
  if (book.length === 0) return errorResponse('Dự án chưa có hạng mục nào trong APL để lập đơn giá', 404)

  // Giá đã đặt (nếu có) để điền sẵn — xuất lại để sửa.
  const prices = await prisma.aplItemWorkshopPrice.findMany({
    where: { importId: imp.id, teamCode }, select: { item: true, stageCode: true, categoryCode: true, unitPrice: true },
  })
  const priceOf = new Map(prices.map(p => [`${p.item}::${p.stageCode}::${p.categoryCode}`, Number(p.unitPrice)]))

  // Gom sổ theo hạng mục, GIỮ NGUYÊN thứ tự dòng trong sổ (công đoạn → chủng loại → Khác).
  const byItem = new Map<string, typeof book>()
  for (const b of book) { const arr = byItem.get(b.item) || []; arr.push(b); byItem.set(b.item, arr) }

  const wb = new ExcelJS.Workbook()
  wb.creator = 'IBS ERP'
  const ws = wb.addWorksheet('Đơn giá giao khoán', { views: [{ state: 'frozen', ySplit: 5 }] })
  ws.columns = [
    { header: '', width: 6 },   // STT
    { header: '', width: 26 },  // Hạng mục/item
    { header: '', width: 8 },   // Mã CĐ
    { header: '', width: 18 },  // Công đoạn
    { header: '', width: 8 },   // Mã CL
    { header: '', width: 40 },  // Chủng loại
    { header: '', width: 16 },  // Đơn giá
  ]
  ws.mergeCells('A1:G1')
  ws.getCell('A1').value = `ĐƠN GIÁ GIAO KHOÁN — ${wsName(teamCode)} (${teamCode})`
  ws.getCell('A1').font = { bold: true, size: 14 }
  ws.mergeCells('A2:G2')
  ws.getCell('A2').value = `Dự án ${project?.projectCode || ''} — ${project?.projectName || ''} · APL ${imp.fileName}`
  ws.getCell('A2').font = { size: 10, italic: true }
  ws.mergeCells('A3:G3')
  ws.getCell('A3').value = 'XƯỞNG điền cột "Đơn giá" (đồng/đơn vị) cho từng chủng loại rồi Import lại. KHÔNG sửa cột Mã CĐ / Mã CL. Chủng loại lạ ngoài danh sách → điền vào dòng "Khác" của hạng mục đó.'
  ws.getCell('A3').font = { size: 10, italic: true, color: { argb: 'FFB45309' } }

  const head = ws.getRow(5)
  head.values = ['STT', 'Hạng mục/item', 'Mã CĐ', 'Công đoạn', 'Mã CL', 'Chủng loại', 'Đơn giá']
  head.font = { bold: true }
  head.eachCell(c => { c.alignment = { horizontal: 'center', wrapText: true }; c.border = { bottom: { style: 'medium' } } })

  let r = 6, stt = 0
  const put = (item: string, stageCode: string, stageName: string, catCode: string, catName: string) => {
    const row = ws.getRow(r++)
    row.getCell(1).value = ''
    row.getCell(2).value = item === ITEM_CA_DU_AN ? '(Cả dự án)' : (item || '(không có item)')
    row.getCell(3).value = stageCode
    row.getCell(4).value = stageName
    row.getCell(5).value = catCode
    row.getCell(6).value = catName
    const gia = priceOf.get(`${item}::${stageCode}::${catCode}`)
    row.getCell(7).value = gia ?? null
    row.getCell(7).numFmt = '#,##0'
  }
  const catLabel = (sc: string, cc: string): string => {
    if (cc === KHAC_CATEGORY) return 'Khác — chủng loại ngoài danh sách trên'
    if (!sc && !cc) return '(đơn giá cho cả lệnh)'
    if (!cc) return '(không có chủng loại)'
    return categoriesOf(sc).find(c => c.code === cc)?.label || cc
  }
  const stageLabel = (sc: string, cc: string): string => {
    if (!sc && cc === KHAC_CATEGORY) return ''
    if (!sc) return '(cả lệnh)'
    return findStage(sc)?.label || sc
  }
  for (const [item, rowsOfItem] of [...byItem.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    stt++
    const itemStart = r
    for (const b of rowsOfItem) put(item, b.stageCode, stageLabel(b.stageCode, b.categoryCode), b.categoryCode, catLabel(b.stageCode, b.categoryCode))
    ws.getCell(itemStart, 1).value = stt
    if (r - 1 > itemStart) { ws.mergeCells(itemStart, 1, r - 1, 1); ws.mergeCells(itemStart, 2, r - 1, 2) }
    ws.getCell(itemStart, 1).alignment = { vertical: 'middle', horizontal: 'center' }
    ws.getCell(itemStart, 2).alignment = { vertical: 'middle', wrapText: true }
    ws.getCell(itemStart, 2).font = { bold: true }
  }
  ws.eachRow((row, n) => { if (n >= 6) row.eachCell(c => { c.border = { ...c.border, top: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' }, bottom: { style: 'thin' } } }) })

  const buf = await wb.xlsx.writeBuffer()
  const fname = `Don-gia-khoan_${project?.projectCode || 'DA'}_${teamCode}.xlsx`
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fname}"`,
    },
  })
}
