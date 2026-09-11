// Xuất mẫu "Đơn giá giao khoán dự án" ra Excel.
//
//   STT | Hạng mục/item | Công đoạn | Chi tiết | Đơn giá
//
// Mỗi hạng mục là MỘT khối, bên trong trải hết công đoạn × chủng loại theo file
// "Mã CV - Chủng loại.xlsx" của Phòng QLSX. KTKH chỉ việc điền cột Đơn giá.
//
// Pha cắt tách thành khối RIÊNG ở đầu bảng vì nó giao MỘT LẦN cho cả dự án (chốt
// nghiệp vụ 07/09/2026) — nó chuẩn bị phôi cho mọi hạng mục nên không chia theo hạng mục.
// Khoan và Sấn lốc nằm trong khối Pha cắt, không lặp lại ở khối Gia công của từng hạng mục.
//
//   node scripts/xuat-mau-don-gia-khoan.mjs [mã dự án] [số hạng mục]
//   node scripts/xuat-mau-don-gia-khoan.mjs TEST-SIDEBAR-26366 4

import 'dotenv/config'
import path from 'node:path'
import os from 'node:os'
import ExcelJS from 'exceljs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }),
})

// ── Danh mục công việc — chép NGUYÊN VĂN "Diễn giải" từ Mã CV - Chủng loại.xlsx ──
// Thứ tự dưới đây là thứ tự SẢN XUẤT (gia công → gá → hàn → … → giao hàng), không phải
// thứ tự trong file (file xếp hai cột cho vừa trang giấy).
const PHA_CAT = {
  ma: 'PC', ten: 'Pha cắt',
  chungLoai: [
    { ma: 'TT', ten: 'Pha cắt tôn tấm' },
    { ma: 'TH', ten: 'Pha cắt thép hình' },
    { ma: 'IN', ten: 'Pha cắt Inox, hợp kim' },
    // Hai dòng này trong file nằm ở nhóm GC (Gia công). Xưởng Pha cắt chuẩn bị phôi cho mọi
    // công đoạn sau nên nghiệp vụ chốt đưa vào Pha cắt — và vì thế KHÔNG lặp ở khối Gia công.
    { ma: 'KH', ten: 'Khoan' },
    { ma: 'SL', ten: 'Sấn lốc' },
  ],
}

const CONG_DOAN = [
  { ma: 'GC', ten: 'Gia công', chungLoai: [
    { ma: 'CK', ten: 'Gia công chính xác (tiện)' },
  ] },
  { ma: 'G', ten: 'Gá', chungLoai: [
    { ma: 'KC', ten: 'Gá kết cấu' },
    { ma: 'KK', ten: 'Gá khung kiện' },
    { ma: 'TB', ten: 'Gá thiết bị' },
    { ma: 'CT', ten: 'Gá cầu thang lan can' },
    { ma: 'TĐ', ten: 'Gá tổng đoạn' },
  ] },
  { ma: 'H', ten: 'Hàn', chungLoai: [
    { ma: 'KC', ten: 'Hàn kết cấu' },
    { ma: 'KK', ten: 'Hàn khung kiện' },
    { ma: 'TB', ten: 'Hàn thiết bị' },
    { ma: 'CT', ten: 'Hàn cầu thang lan can' },
    { ma: 'TĐ', ten: 'Hàn tổng đoạn' },
  ] },
  { ma: 'TH', ten: 'Tổ hợp', chungLoai: [
    { ma: 'KC', ten: 'Tổ hợp kết cấu' },
    { ma: 'TB', ten: 'Tổ hợp thiết bị' },
    { ma: 'BL', ten: 'Tổ hợp Block' },
  ] },
  { ma: 'VH', ten: 'Vận hành', chungLoai: [
    { ma: 'LĐ', ten: 'Tổ hợp sản phẩm' },
    { ma: 'LT', ten: 'Lắp thiết bị' },
    { ma: 'CN', ten: 'Vận hành chạy thử chức năng' },
  ] },
  { ma: 'TA', ten: 'Thử áp', chungLoai: [
    { ma: 'TA', ten: 'Thử áp' },
  ] },
  { ma: 'Ax', ten: 'Rửa acid', chungLoai: [
    { ma: 'Ax', ten: 'Rửa acid; Xà phòng - inox, hợp kim' },
  ] },
  { ma: 'LS', ten: 'Làm sạch', chungLoai: [
    { ma: 'TB', ten: 'Làm sạch KC, Thiết bị (Thợ làm sạch và phụ làm sạch)' },
    { ma: 'BL', ten: 'Làm sạch Block' },
    { ma: 'KK', ten: 'Làm sạch khung kiện' },
    { ma: 'IN', ten: 'Làm sạch inox, hợp kim' },
    { ma: 'M', ten: 'Làm sạch sản phẩm đi mạ kẽm' },
  ] },
  { ma: 'S', ten: 'Sơn', chungLoai: [
    { ma: 'TB', ten: 'Sơn KC, Thiết bị (Sơn, sửa sơn nghiệm thu)' },
    { ma: 'BL', ten: 'Sơn Block' },
    { ma: 'KK', ten: 'Sơn khung kiện' },
    { ma: 'IN', ten: 'Sơn inox, hợp kim' },
    { ma: 'M', ten: 'Sơn sản phẩm mạ kẽm' },
  ] },
  { ma: 'BO', ten: 'Bảo ôn', chungLoai: [
    { ma: 'PH', ten: 'Bảo ôn phên ngửa (Bông + Liner)' },
    { ma: 'SD', ten: 'Bảo ôn dạng hộp đinh thẳng (Stud) (Bông + Liner)' },
    { ma: 'SC', ten: 'Bảo ôn các loại với đinh dạng Scalope (Chân tôn) (Bông + Liner)' },
  ] },
  { ma: 'ĐK', ten: 'Đóng kiện', chungLoai: [
    { ma: 'HR', ten: 'Đóng kiện hàng rời' },
    { ma: 'KH', ten: 'Đóng kiện hàng khối (Block, ống khói, Hộp lớn…)' },
  ] },
  // PT và CO trong file có diễn giải GIỐNG HỆT nhau — kèm mã vào để đọc ra hai dòng khác nhau.
  { ma: 'GH', ten: 'Giao hàng', chungLoai: [
    { ma: 'PT', ten: 'Giao hàng lên xe tải, lên xà lan hoặc lên tàu thủy (PT)' },
    { ma: 'CO', ten: 'Giao hàng lên xe tải, lên xà lan hoặc lên tàu thủy (CO)' },
  ] },
  { ma: 'PS', ten: 'Phát sinh', chungLoai: [
    { ma: '', ten: 'Những công việc phát sinh không có trong phạm vi công việc tổ được phân giao' },
  ] },
]

// ── Định dạng ──
//
// Bảng kẻ ô ĐEN TRẮNG, không tô màu. Mọi ô đều có khung nét liền để ra đúng hình một cái
// bảng — nét 'hair' của Excel mảnh tới mức in ra gần như mất, nhìn không ra bảng.
// Phân cấp bằng ĐỘ DÀY nét, không bằng màu:
//   • viền ngoài bảng + hết một HẠNG MỤC → nét đậm (medium)
//   • hết một CÔNG ĐOẠN → nét vừa, chỉ từ cột Công đoạn sang phải
//   • giữa các dòng chi tiết → nét thường (thin)
const DEN = 'FF000000'
const VIEN = { style: 'thin', color: { argb: DEN } }
const VIEN_VUA = { style: 'thin', color: { argb: DEN } }
const VIEN_DAM = { style: 'medium', color: { argb: DEN } }
const KHUNG = { top: VIEN, left: VIEN, bottom: VIEN, right: VIEN }

async function main() {
  const maDuAn = process.argv[2] || 'TEST-SIDEBAR-26366'
  const soHangMuc = Number(process.argv[3]) || 4

  const duAn = await prisma.project.findFirst({
    where: { projectCode: maDuAn },
    select: { id: true, projectCode: true, projectName: true },
  })
  if (!duAn) throw new Error(`Không thấy dự án ${maDuAn}`)

  const apl = await prisma.aplImport.findFirst({
    where: { projectId: duAn.id }, orderBy: { createdAt: 'desc' },
    select: { id: true, fileName: true },
  })
  if (!apl) throw new Error(`Dự án ${maDuAn} chưa nhập APL — không có hạng mục nào để lấy mẫu`)

  // Hạng mục lấy từ APL, ưu tiên cái nặng nhất (đó là những cái đáng đặt giá trước).
  const gom = await prisma.aplLine.groupBy({
    by: ['item'], where: { importId: apl.id, isAssembly: true }, _sum: { rollupWeightKg: true },
  })
  const hangMuc = gom
    .filter(x => x.item)
    .sort((a, b) => Number(b._sum.rollupWeightKg) - Number(a._sum.rollupWeightKg))
    .slice(0, soHangMuc)
    .map(x => x.item)

  const wb = new ExcelJS.Workbook()
  wb.creator = 'IBS ERP'
  const ws = wb.addWorksheet('Đơn giá giao khoán', {
    views: [{ state: 'frozen', ySplit: 5 }],
    // In ra giấy thì đầu bảng lặp lại mỗi trang — 153 dòng trải 4-5 trang, không có dòng
    // tiêu đề thì sang trang thứ hai là không biết cột nào là cột nào.
    pageSetup: {
      paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      printTitlesRow: '5:5', margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  })

  ws.columns = [
    { width: 6 },   // STT
    { width: 24 },  // Hạng mục/item
    { width: 16 },  // Công đoạn
    { width: 52 },  // Chi tiết
    { width: 18 },  // Đơn giá
  ]

  // ── Tiêu đề ──
  ws.mergeCells('A1:E1')
  const t1 = ws.getCell('A1')
  t1.value = `ĐƠN GIÁ GIAO KHOÁN DỰ ÁN: ${duAn.projectCode} — ${duAn.projectName}`
  t1.font = { bold: true, size: 14 }
  t1.alignment = { vertical: 'middle' }
  ws.getRow(1).height = 24

  ws.mergeCells('A2:E2')
  const t2 = ws.getCell('A2')
  t2.value = `Danh mục công việc theo "Mã CV - Chủng loại" (Phòng QLSX) · Hạng mục lấy từ ${apl.fileName}`
  t2.font = { size: 10, italic: true }

  ws.mergeCells('A3:E3')
  const t3 = ws.getCell('A3')
  t3.value = 'Cột "Đơn giá" để trống — KTKH điền đơn giá khoán (đồng/đơn vị) cho từng công đoạn.'
  t3.font = { size: 10, italic: true }

  // ── Đầu bảng ──
  const dauBang = ws.getRow(5)
  dauBang.values = ['STT', 'Hạng mục/item', 'Công đoạn', 'Chi tiết', 'Đơn giá']
  dauBang.height = 22
  dauBang.eachCell(c => {
    c.font = { bold: true, size: 11 }
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    // Đầu bảng viền đậm trên dưới để tách hẳn khỏi phần tiêu đề ở trên.
    c.border = { top: VIEN_DAM, left: VIEN, bottom: VIEN_DAM, right: VIEN }
  })

  // ── Nội dung ──
  // Mỗi khối = một hạng mục. Trong khối, gộp ô STT + Hạng mục theo chiều dọc, và gộp ô
  // Công đoạn cho các chủng loại của nó — đúng cách đọc trên giấy: nhìn tên một lần.
  let dong = 6
  const khoi = []   // để gộp ô sau khi đã ghi hết

  const ghiKhoi = (stt, tenHangMuc, dsCongDoan) => {
    const dongDau = dong

    for (const cd of dsCongDoan) {
      const dongDauCD = dong
      for (const cl of cd.chungLoai) {
        const r = ws.getRow(dong)
        r.height = 16
        r.getCell(1).value = dong === dongDau ? stt : null
        r.getCell(2).value = dong === dongDau ? tenHangMuc : null
        r.getCell(3).value = dong === dongDauCD ? cd.ten : null
        r.getCell(4).value = cl.ten
        r.getCell(5).value = null

        for (let i = 1; i <= 5; i++) {
          const c = r.getCell(i)
          c.border = { ...KHUNG }
          c.font = { size: 10 }
        }
        // Hết một CÔNG ĐOẠN: kẻ vừa từ cột Công đoạn sang phải, để nhóm chủng loại đứng rời nhau.
        if (dong === dongDauCD && dong !== dongDau) {
          for (let i = 3; i <= 5; i++) r.getCell(i).border = { ...KHUNG, top: VIEN_VUA }
        }
        // Hết một HẠNG MỤC: kẻ đậm ngang cả bảng.
        if (dong === dongDau) {
          for (let i = 1; i <= 5; i++) r.getCell(i).border = { ...KHUNG, top: VIEN_DAM }
        }

        r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' }
        r.getCell(1).font = { size: 11, bold: true }
        r.getCell(2).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
        r.getCell(2).font = { size: 11, bold: true }
        r.getCell(3).alignment = { horizontal: 'left', vertical: 'middle' }
        r.getCell(3).font = { size: 10, bold: true }
        r.getCell(4).alignment = { vertical: 'middle', wrapText: true, indent: 1 }
        r.getCell(5).numFmt = '#,##0'
        r.getCell(5).alignment = { horizontal: 'right', vertical: 'middle' }
        dong++
      }
      if (dong - dongDauCD > 1) khoi.push([dongDauCD, 3, dong - 1, 3])
    }

    // Đáy khối: kẻ đậm để khối cuối cùng cũng có viền dưới.
    for (let i = 1; i <= 5; i++) {
      const c = ws.getRow(dong - 1).getCell(i)
      c.border = { ...c.border, bottom: VIEN_DAM }
    }
    if (dong - dongDau > 1) {
      khoi.push([dongDau, 1, dong - 1, 1])
      khoi.push([dongDau, 2, dong - 1, 2])
    }
  }

  // 1 — Pha cắt: giao MỘT LẦN cho cả dự án, không thuộc hạng mục nào.
  ghiKhoi(1, 'Pha cắt — cả dự án', [PHA_CAT])

  // 2..n — từng hạng mục, trải hết công đoạn còn lại.
  hangMuc.forEach((ten, i) => ghiKhoi(i + 2, ten, CONG_DOAN))

  for (const [r1, c1, r2, c2] of khoi) ws.mergeCells(r1, c1, r2, c2)

  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: dong - 1, column: 5 } }

  // File cũ đang mở trong Excel thì Windows khoá, không ghi đè được — ghi ra tên kế tiếp
  // thay vì đổ, để khỏi phải đóng Excel rồi chạy lại.
  const thuMuc = path.join(os.homedir(), 'Downloads')
  let duong = path.join(thuMuc, `Don-gia-giao-khoan_${duAn.projectCode}.xlsx`)
  for (let lan = 2; ; lan++) {
    try { await wb.xlsx.writeFile(duong); break } catch (e) {
      if (e.code !== 'EBUSY' && e.code !== 'EPERM') throw e
      if (lan > 20) throw e
      duong = path.join(thuMuc, `Don-gia-giao-khoan_${duAn.projectCode}-v${lan}.xlsx`)
    }
  }

  const soDong = dong - 6
  console.log(`Dự án : ${duAn.projectCode} — ${duAn.projectName}`)
  console.log(`Hạng mục mẫu: ${hangMuc.join(', ')}`)
  console.log(`Số dòng đơn giá: ${soDong} (Pha cắt ${PHA_CAT.chungLoai.length} dòng`
    + ` + ${hangMuc.length} hạng mục × ${CONG_DOAN.reduce((n, c) => n + c.chungLoai.length, 0)} dòng)`)
  console.log(`Đã ghi: ${duong}`)
}

main()
  .catch(e => { console.error('LỖI:', e.message); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
