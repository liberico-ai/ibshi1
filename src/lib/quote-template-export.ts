import * as XLSX from 'xlsx'
import type { PrItem } from './quote-parser'

interface ExportOpts {
  projectCode?: string
  projectName?: string
  date?: string
}

const CATEGORY_ORDER = ['VTC', 'VPK', 'VDK', 'Grating', 'Khác']

function detectCategory(item: PrItem): string {
  const code = (item.stt || item.code || item.materialCode || '').toUpperCase()
  if (code.includes('VTC')) return 'VTC'
  if (code.includes('VPK')) return 'VPK'
  if (code.includes('VDK')) return 'VDK'
  const desc = (item.description || item.materialName || item.name || '').toLowerCase()
  if (/grating/i.test(desc)) return 'Grating'
  return 'Khác'
}

export function exportQuoteTemplate(prItems: PrItem[], opts: ExportOpts = {}): XLSX.WorkBook {
  const buyItems = prItems.filter(p => {
    const qty = typeof p.needToBuyQty === 'number' ? p.needToBuyQty : (p.quantity || p.qty || 0)
    return qty > 0
  })

  const groups = new Map<string, PrItem[]>()
  for (const item of buyItems) {
    const cat = detectCategory(item)
    if (!groups.has(cat)) groups.set(cat, [])
    groups.get(cat)!.push(item)
  }

  const aoa: (string | number | null)[][] = []

  aoa.push(['BG chuẩn hóa'])
  aoa.push(['Dự án:', opts.projectCode || '', null, 'Ngày:', opts.date || new Date().toISOString().slice(0, 10)])
  aoa.push(['Tên DA:', opts.projectName || ''])
  aoa.push([])
  aoa.push([null, null, null, 'Yêu cầu (IBS)', null, null, null, null, 'Đề xuất (NCC)', null, null])
  aoa.push(['Item', 'Mã vật tư', 'Description', 'Profile', 'Grade', 'ĐVT', 'Cần mua', 'Số lượng', 'Đơn giá', 'Thành tiền'])

  let excelRow = 7
  const formulaCells: [string, string][] = []

  const sortedCats = [...groups.keys()].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a)
    const ib = CATEGORY_ORDER.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })

  for (const cat of sortedCats) {
    aoa.push([cat])
    excelRow++

    for (const item of groups.get(cat)!) {
      const code = item.stt || item.code || item.materialCode || ''
      const desc = item.description || item.materialName || item.name || ''
      const profile = item.profile || ''
      const grade = item.grade || ''
      const unit = item.unit || item.uom || ''
      const qty = typeof item.needToBuyQty === 'number' ? item.needToBuyQty : (item.quantity || item.qty || 0)

      const matCode = item.canonicalCode || ''
      aoa.push([code, matCode, desc, profile, grade, unit, qty, null, null, null])
      formulaCells.push([`J${excelRow}`, `H${excelRow}*I${excelRow}`])
      excelRow++
    }
  }

  aoa.push([])
  excelRow++

  const totalRow = excelRow
  aoa.push([null, null, null, null, null, null, null, null, 'Cộng:', null])
  formulaCells.push([`J${totalRow}`, `SUM(J7:J${totalRow - 2})`])
  excelRow++

  const vatRow = excelRow
  aoa.push([null, null, null, null, null, null, null, null, 'VAT 10%:', null])
  formulaCells.push([`J${vatRow}`, `J${totalRow}*0.1`])
  excelRow++

  aoa.push([null, null, null, null, null, null, null, null, 'Tổng cộng:', null])
  formulaCells.push([`J${excelRow}`, `J${totalRow}+J${vatRow}`])

  const ws = XLSX.utils.aoa_to_sheet(aoa)

  for (const [ref, formula] of formulaCells) {
    ws[ref] = { t: 'n', v: 0, f: formula }
  }

  ws['!cols'] = [
    { wch: 20 }, { wch: 18 }, { wch: 30 }, { wch: 25 }, { wch: 10 },
    { wch: 6 }, { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 18 },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'BG')
  return wb
}
