/**
 * Export toàn bộ dữ liệu kho từ production ra Excel
 * Usage: DATABASE_URL=<chuỗi kết nối prod> npx tsx scripts/export-warehouse-excel.ts
 * (credential lấy từ biến môi trường DATABASE_URL — KHÔNG hardcode trong file)
 */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import * as XLSX from 'xlsx'
import path from 'path'

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('❌ DATABASE_URL chưa set (đặt biến môi trường trước khi chạy).')
    process.exit(1)
  }
  const isRemote = !connectionString.includes('@localhost') && !connectionString.includes('@127.0.0.1')
  const pool = new pg.Pool({ connectionString, max: 3, ...(isRemote && { ssl: { rejectUnauthorized: false } }) })
  const adapter = new PrismaPg(pool as unknown as ConstructorParameters<typeof PrismaPg>[0])
  const prisma = new PrismaClient({ adapter })

  console.log('Connecting to production DB...')

  const materials = await prisma.material.findMany({
    orderBy: [{ category: 'asc' }, { materialCode: 'asc' }],
    include: {
      stocks: {
        include: { warehouse: true },
      },
    },
  })

  console.log(`Found ${materials.length} materials`)

  // Sheet 1: Tổng hợp vật tư
  // Giá trị tồn = SUM(MaterialStock.value) theo từng vật tư (giá trị kế toán thực)
  const summaryRows = materials.map((m) => {
    const totalStock = Number(m.currentStock) || 0
    const reserved = Number(m.reservedStock) || 0
    const available = totalStock - reserved
    const minStock = Number(m.minStock)
    const lowStock = minStock >= 0 && totalStock <= minStock
    const stockValue = m.stocks.reduce((sum, s) => sum + Number(s.value), 0)
    const projects = m.stocks
      .filter((s) => s.warehouse.projectCode)
      .map((s) => s.warehouse.projectCode)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(', ')

    return {
      'Mã vật tư': m.materialCode,
      'Tên vật tư': m.name,
      'Tên (EN)': m.nameEn || '',
      'Profile': m.specification || '',
      'Mác': m.grade || '',
      'Danh mục': m.category,
      'Nhóm': m.groupCode || '',
      'ĐVT': m.unit,
      'Tồn kho': totalStock,
      'Đã đặt trước': reserved,
      'Khả dụng': available,
      'Tồn tối thiểu': minStock,
      'Đơn giá': Number(m.unitPrice) || 0,
      'Tiền tệ': m.currency,
      'Giá trị tồn (kế toán)': stockValue,
      'Dự án': projects,
      'Trạng thái': m.status,
      'Thiếu hàng': lowStock ? 'Có' : '',
      'Mã tạm': m.isProvisional ? 'Có' : '',
      'Nguồn tạo': m.createdByUnit || '',
    }
  })

  // Sheet 2: Chi tiết tồn theo kho/dự án
  const stockRows: Record<string, unknown>[] = []
  for (const m of materials) {
    for (const s of m.stocks) {
      if (Number(s.quantity) === 0 && Number(s.value) === 0) continue
      stockRows.push({
        'Mã vật tư': m.materialCode,
        'Tên vật tư': m.name,
        'Profile': m.specification || '',
        'Mác': m.grade || '',
        'ĐVT': m.unit,
        'Mã kho': s.warehouse.code,
        'Tên kho': s.warehouse.name,
        'Dự án': s.warehouse.projectCode || 'Kho chung',
        'Loại kho': s.warehouse.kind,
        'Số lượng tồn': Number(s.quantity),
        'Giá trị': Number(s.value),
        'Đơn giá BQ': Number(s.quantity) > 0 ? Math.round(Number(s.value) / Number(s.quantity)) : 0,
      })
    }
  }

  // Sheet 3: Thống kê theo danh mục
  const catMap = new Map<string, { count: number; stock: number; value: number; lowStock: number }>()
  for (const m of materials) {
    const cat = m.category || 'Khác'
    const entry = catMap.get(cat) || { count: 0, stock: 0, value: 0, lowStock: 0 }
    entry.count++
    entry.stock += Number(m.currentStock) || 0
    entry.value += m.stocks.reduce((sum, s) => sum + Number(s.value), 0)
    const minStock = Number(m.minStock)
    if (minStock >= 0 && (Number(m.currentStock) || 0) <= minStock) entry.lowStock++
    catMap.set(cat, entry)
  }
  const catRows = Array.from(catMap.entries())
    .sort((a, b) => b[1].value - a[1].value)
    .map(([cat, data]) => ({
      'Danh mục': cat,
      'Số mã VT': data.count,
      'Tổng tồn kho': data.stock,
      'Tổng giá trị': data.value,
      'Thiếu hàng': data.lowStock,
    }))

  // Build workbook
  const wb = XLSX.utils.book_new()

  const ws1 = XLSX.utils.json_to_sheet(summaryRows)
  ws1['!cols'] = [
    { wch: 22 }, { wch: 40 }, { wch: 30 }, { wch: 20 }, { wch: 12 },
    { wch: 12 }, { wch: 10 }, { wch: 6 }, { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 6 }, { wch: 16 },
    { wch: 30 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 10 },
  ]
  XLSX.utils.book_append_sheet(wb, ws1, 'Tong hop vat tu')

  const ws2 = XLSX.utils.json_to_sheet(stockRows)
  ws2['!cols'] = [
    { wch: 22 }, { wch: 40 }, { wch: 20 }, { wch: 12 }, { wch: 6 },
    { wch: 15 }, { wch: 25 }, { wch: 20 }, { wch: 12 }, { wch: 14 },
    { wch: 14 }, { wch: 14 },
  ]
  XLSX.utils.book_append_sheet(wb, ws2, 'Ton theo kho')

  const ws3 = XLSX.utils.json_to_sheet(catRows)
  ws3['!cols'] = [{ wch: 15 }, { wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 12 }]
  XLSX.utils.book_append_sheet(wb, ws3, 'Theo danh muc')

  const outPath = path.join(process.cwd(), 'Bao_cao_Kho_IBS_2026-06-29.xlsx')
  XLSX.writeFile(wb, outPath)

  console.log(`\nExported ${materials.length} materials to: ${outPath}`)
  console.log(`  Sheet 1: Tong hop vat tu — ${summaryRows.length} rows`)
  console.log(`  Sheet 2: Ton theo kho — ${stockRows.length} rows`)
  console.log(`  Sheet 3: Theo danh muc — ${catRows.length} rows`)

  const totalValue = summaryRows.reduce((s, r) => s + (r['Giá trị tồn (kế toán)'] as number), 0)
  const lowStockCount = summaryRows.filter((r) => r['Thiếu hàng'] === 'Có').length
  console.log(`\nTong gia tri ton kho: ${new Intl.NumberFormat('vi-VN').format(totalValue)} VND`)
  console.log(`Thieu hang: ${lowStockCount}/${materials.length}`)

  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
