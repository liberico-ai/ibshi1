import { NextRequest } from 'next/server'
import ExcelJS from 'exceljs'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { buildKhoanReport, type KhoanReport } from '@/lib/khoan-report'
import { docBoLoc } from '@/lib/khoan-report-filter'

export const dynamic = 'force-dynamic'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/khoan-theo-xuong/export?xuong=&duAn=&tuNgay=&denNgay=
//
// Xuất ra Excel ĐÚNG phần đang lọc trên màn báo cáo — cùng tham số, cùng lõi tính
// (buildKhoanReport), nên file không bao giờ lệch với thứ đang nhìn thấy.
//
// File luôn có ba sheet: Theo xưởng / Theo lệnh / Theo công đoạn — ba cách nhìn của cùng
// một tập dữ liệu đã lọc, không phải ba lựa chọn phải bấm chọn trước.
//
// Dùng ExcelJS chứ không phải xlsx: bản CE của xlsx BỎ QUA mọi định dạng ô, nên không kẻ
// được khung bảng, không tô đầu bảng, không định dạng số. Mở ra là một mớ chữ trần.
//
// Phạm vi vẫn theo luật của màn báo cáo: xưởng chỉ xuất được xưởng mình.
// ─────────────────────────────────────────────────────────────────────────────

const XANH = 'FF1E4E79'      // nền đầu bảng
const XAM_NHAT = 'FFF2F5F9'  // nền dòng chẵn
const VIEN = 'FFBFC9D4'

type Cot = { ten: string; rong: number; dinhDang?: string; canGiua?: boolean }

/** Số lượng: nghìn có dấu phân cách, để trống thì không hiện 0 */
const SO = '#,##0'
const TIEN = '#,##0 "₫"'
const PHAN_TRAM = '0%'

/** Ngày giờ đặt tên file, theo giờ VN — hai lần xuất trong ngày không đè lên nhau. */
function dauThoiGian() {
  const d = new Date(Date.now() + 7 * 3600 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`
}

/** Tên file nói luôn đang lọc gì — mở ra là biết file này của kỳ nào, xưởng nào. */
function tenFile(loc: { teamCode?: string; tuNgayText?: string; denNgayText?: string }) {
  const phan = ['KhoanTheoXuong']
  if (loc.teamCode) phan.push(loc.teamCode)
  if (loc.tuNgayText || loc.denNgayText) {
    phan.push(`${loc.tuNgayText || 'dau'}_${loc.denNgayText || 'nay'}`)
  }
  phan.push(dauThoiGian())
  return phan.join('-').replace(/[^A-Za-z0-9._-]+/g, '-') + '.xlsx'
}

const lam = (n: number) => Math.round(n * 100) / 100

/**
 * Dựng một sheet dạng BẢNG: tiêu đề, hàng đầu bảng tô nền, kẻ khung mọi ô, khoá dòng đầu,
 * bật lọc, và tự giãn cột. Ba sheet dùng chung để trông như một bộ, không phải ba kiểu.
 */
function dungSheet(
  wb: ExcelJS.Workbook,
  tenSheet: string,
  tieuDe: string,
  cots: Cot[],
  duLieu: (string | number | null)[][],
  ghiChuDuoi?: string,
) {
  const ws = wb.addWorksheet(tenSheet, {
    views: [{ state: 'frozen', ySplit: 3 }],   // khoá tiêu đề + đầu bảng
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  ws.columns = cots.map(c => ({ width: c.rong }))

  // Dòng 1: tiêu đề sheet
  ws.mergeCells(1, 1, 1, cots.length)
  const oTieuDe = ws.getCell(1, 1)
  oTieuDe.value = tieuDe
  oTieuDe.font = { bold: true, size: 13, color: { argb: XANH } }
  oTieuDe.alignment = { vertical: 'middle' }
  ws.getRow(1).height = 22

  // Dòng 2: để trống cho thoáng
  ws.getRow(2).height = 6

  // Dòng 3: đầu bảng
  const dauBang = ws.getRow(3)
  cots.forEach((c, i) => {
    const o = dauBang.getCell(i + 1)
    o.value = c.ten
    o.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
    o.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XANH } }
    o.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    o.border = { top: { style: 'thin', color: { argb: XANH } }, left: { style: 'thin', color: { argb: XANH } }, bottom: { style: 'thin', color: { argb: XANH } }, right: { style: 'thin', color: { argb: XANH } } }
  })
  dauBang.height = 28

  // Dữ liệu
  duLieu.forEach((dong, k) => {
    const r = ws.getRow(4 + k)
    cots.forEach((c, i) => {
      const o = r.getCell(i + 1)
      const v = dong[i]
      // null = ô để TRỐNG có chủ ý (vd chưa có đơn giá) — khác 0, đừng ghi 0 vào.
      o.value = v === null ? null : v
      if (c.dinhDang) o.numFmt = c.dinhDang
      o.alignment = { horizontal: c.canGiua ? 'center' : (typeof v === 'number' ? 'right' : 'left'), vertical: 'middle' }
      o.font = { size: 10 }
      o.border = {
        top: { style: 'hair', color: { argb: VIEN } }, left: { style: 'hair', color: { argb: VIEN } },
        bottom: { style: 'hair', color: { argb: VIEN } }, right: { style: 'hair', color: { argb: VIEN } },
      }
      if (k % 2 === 1) o.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XAM_NHAT } }
    })
  })

  // Bật lọc trên đầu bảng — người dùng lọc tiếp trong Excel được
  if (duLieu.length > 0) {
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + duLieu.length, column: cots.length } }
  }

  if (ghiChuDuoi) {
    const r = ws.getRow(5 + duLieu.length)
    ws.mergeCells(r.number, 1, r.number, cots.length)
    const o = r.getCell(1)
    o.value = ghiChuDuoi
    o.font = { size: 9, italic: true, color: { argb: 'FF6B7785' } }
    o.alignment = { wrapText: true, vertical: 'top' }
    r.height = 28
  }
  return ws
}

/** Ô để trống khi chưa có đơn giá; có giá thì ghi số (kể cả 0). */
const tienHoacTrong = (v: number | null) => (v === null ? null : Math.round(v))

export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const loc = docBoLoc(req)
    const rp: KhoanReport = await buildKhoanReport(user.userId, user.roleCode, loc)
    if (rp.scopeMissing) {
      return errorResponse('Tài khoản chưa gắn xưởng nên không có dữ liệu để xuất', 403)
    }
    if (rp.workshops.length === 0) {
      return errorResponse('Bộ lọc hiện tại không có dòng nào để xuất', 404)
    }

    const kyHan = loc.tuNgayText || loc.denNgayText
      ? `${loc.tuNgayText || 'từ đầu'} → ${loc.denNgayText || 'nay'}`
      : 'toàn bộ thời gian'
    const nhanLoc = `Xưởng: ${loc.teamCode || 'tất cả'} · Kỳ: ${kyHan}`

    const wb = new ExcelJS.Workbook()
    wb.creator = 'IBS ERP'
    wb.created = new Date()

    // ── Sheet 1: theo XƯỞNG ──
    dungSheet(wb, 'Theo xưởng', `KHOÁN THEO XƯỞNG — ${nhanLoc}`, [
      { ten: 'Mã xưởng', rong: 12, canGiua: true },
      { ten: 'Xưởng', rong: 24 },
      { ten: 'Số dự án', rong: 10, dinhDang: SO },
      { ten: 'Số lệnh', rong: 10, dinhDang: SO },
      { ten: 'KL giao', rong: 14, dinhDang: SO },
      { ten: 'Đã báo', rong: 14, dinhDang: SO },
      { ten: 'Đã nghiệm thu', rong: 16, dinhDang: SO },
      { ten: 'Hoàn thành', rong: 12, dinhDang: PHAN_TRAM },
      { ten: 'Giá trị khoán', rong: 18, dinhDang: TIEN },
      { ten: 'Công đoạn chưa có đơn giá', rong: 22, dinhDang: SO },
    ], rp.workshops.map(w => [
      w.teamCode, w.teamName, w.projectCount, w.woCount,
      lam(w.plannedKg), lam(w.reportedKg), lam(w.acceptedKg), w.ratio,
      Math.round(w.amount), w.woWithoutPrice,
    ]),
      'Hoàn thành của xưởng lấy theo KL đã nghiệm thu / KL giao. Một hạng mục giao cho nhiều xưởng thì '
      + 'xưởng nào cũng nhận trọn khối lượng của hạng mục đó, nên cộng ngang các xưởng sẽ lớn hơn số tấn thép thật.')

    // ── Sheet 2: tới từng LỆNH ──
    dungSheet(wb, 'Theo lệnh', `KHOÁN THEO LỆNH SẢN XUẤT — ${nhanLoc}`, [
      { ten: 'Mã xưởng', rong: 12, canGiua: true },
      { ten: 'Xưởng', rong: 20 },
      { ten: 'Mã dự án', rong: 18 },
      { ten: 'Dự án', rong: 30 },
      { ten: 'Lệnh SX', rong: 44 },
      { ten: 'Hạng mục (ITEM)', rong: 30 },
      { ten: 'Trạng thái', rong: 14, canGiua: true },
      { ten: 'Số công đoạn', rong: 12, dinhDang: SO },
      { ten: 'KL giao', rong: 14, dinhDang: SO },
      { ten: 'Đã báo', rong: 14, dinhDang: SO },
      { ten: 'Đã nghiệm thu', rong: 16, dinhDang: SO },
      { ten: 'Hoàn thành', rong: 12, dinhDang: PHAN_TRAM },
      { ten: 'Giá trị khoán', rong: 18, dinhDang: TIEN },
    ], rp.workshops.flatMap(w => w.projects.flatMap(p => p.wos.map(o => [
      w.teamCode, w.teamName, p.projectCode, p.projectName, o.woCode, o.item || '',
      o.status, o.stages.length,
      lam(o.plannedKg), lam(o.reportedKg), lam(o.acceptedKg), o.ratio,
      tienHoacTrong(o.amount),
    ]))),
      'Hoàn thành của LỆNH lấy theo công đoạn CHẬM NHẤT: pha cắt xong 100% mà bảo ôn mới 50% thì lệnh vẫn 50%. '
      + 'Cột Giá trị khoán để TRỐNG nghĩa là chưa công đoạn nào của lệnh có đơn giá.')

    // ── Sheet 3: tới từng CÔNG ĐOẠN ──
    // Lệnh không chia công đoạn vẫn ra MỘT dòng, ghi rõ "(không chia công đoạn)" — bỏ hẳn
    // thì tổng của sheet này hụt so với sheet Theo lệnh mà người đọc không biết vì sao.
    dungSheet(wb, 'Theo công đoạn', `KHOÁN THEO CÔNG ĐOẠN — ${nhanLoc}`, [
      { ten: 'Mã xưởng', rong: 12, canGiua: true },
      { ten: 'Xưởng', rong: 20 },
      { ten: 'Mã dự án', rong: 18 },
      { ten: 'Dự án', rong: 30 },
      { ten: 'Lệnh SX', rong: 44 },
      { ten: 'Hạng mục (ITEM)', rong: 30 },
      { ten: 'Mã CĐ', rong: 10, canGiua: true },
      { ten: 'Công đoạn', rong: 20 },
      { ten: 'Chủng loại', rong: 34 },
      { ten: 'Đơn vị', rong: 9, canGiua: true },
      { ten: 'KL giao', rong: 14, dinhDang: SO },
      { ten: 'Đã báo', rong: 14, dinhDang: SO },
      { ten: 'Đã nghiệm thu', rong: 16, dinhDang: SO },
      { ten: 'Hoàn thành', rong: 12, dinhDang: PHAN_TRAM },
      { ten: 'Đơn giá', rong: 14, dinhDang: TIEN },
      { ten: 'Thành tiền', rong: 18, dinhDang: TIEN },
    ], rp.workshops.flatMap(w => w.projects.flatMap(p => p.wos.flatMap(o => (
      o.stages.length > 0
        ? o.stages.map(st => [
          w.teamCode, w.teamName, p.projectCode, p.projectName, o.woCode, o.item || '',
          st.stageCode, st.name, st.category || '', st.unit,
          lam(st.plannedKg), lam(st.reportedKg), lam(st.acceptedKg), st.ratio,
          tienHoacTrong(st.unitPrice), tienHoacTrong(st.unitPrice === null ? null : (st.amount ?? 0)),
        ])
        : [[
          w.teamCode, w.teamName, p.projectCode, p.projectName, o.woCode, o.item || '',
          '', '(không chia công đoạn)', '', 'kg',
          lam(o.plannedKg), lam(o.reportedKg), lam(o.acceptedKg), o.ratio,
          null, tienHoacTrong(o.amount),
        ]]
    )))),
      'Mỗi công đoạn chạy qua TRỌN khối lượng của lệnh — lệnh 24.784 kg giao 2 công đoạn vẫn là 24.784 kg, '
      + 'nên KHÔNG cộng cột KL giao của các công đoạn lại. Tiền thì CỘNG, vì mỗi công đoạn có đơn giá riêng '
      + 'cho phần việc riêng. Ô Đơn giá / Thành tiền để TRỐNG là chưa nhập đơn giá, khác với 0.')

    // ── Sheet 4: ghi chú ──
    const ws = wb.addWorksheet('Ghi chú')
    ws.columns = [{ width: 30 }, { width: 96 }]
    const dong = (a: string, b: string | number = '', dam = false) => {
      const r = ws.addRow([a, b])
      r.getCell(1).font = { bold: dam || !b, size: 10 }
      r.getCell(2).font = { size: 10 }
      r.getCell(2).alignment = { wrapText: true, vertical: 'top' }
      return r
    }
    ws.addRow([]).getCell(1).value = ''
    const tt = ws.getCell('A1')
    tt.value = 'BÁO CÁO KHOÁN THEO XƯỞNG'
    tt.font = { bold: true, size: 14, color: { argb: XANH } }
    dong('Xuất lúc', new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' (giờ VN)')
    dong('Người xuất', user.fullName || user.username)
    ws.addRow([])
    dong('BỘ LỌC ĐANG ÁP', '', true)
    dong('Xưởng', loc.teamCode || 'tất cả')
    dong('Dự án', loc.projectId ? (rp.workshops[0]?.projects[0]?.projectCode || loc.projectId) : 'tất cả')
    dong('Từ ngày', loc.tuNgayText || 'từ đầu')
    dong('Đến ngày', loc.denNgayText || 'tới hiện tại')
    dong('', 'File này CHỈ chứa phần khớp bộ lọc ở trên — đúng bằng thứ đang hiện trên màn báo cáo.')
    dong('', 'Khoảng ngày lọc theo NGÀY BÁO của phiếu công việc và NGÀY KIỂM của đợt nghiệm thu. '
      + 'Khối lượng GIAO không lọc theo ngày — lệnh giao bao nhiêu vẫn là bấy nhiêu.')
    ws.addRow([])
    dong('TỔNG KHỐI LƯỢNG', 'mỗi hạng mục đếm MỘT lần', true)
    dong('KL giao', lam(rp.totals.plannedKg))
    dong('Đã báo', lam(rp.totals.reportedKg))
    dong('Đã nghiệm thu', lam(rp.totals.acceptedKg))
    dong('Tổng khối lượng VIỆC', lam(rp.totals.workloadKg))
    dong('', 'Khối lượng VIỆC là tổng cộng ngang các xưởng — lớn hơn số tấn thép thật, vì một hạng mục '
      + 'giao cho nhiều xưởng thì xưởng nào cũng nhận trọn khối lượng đó.')
    ws.addRow([])
    dong('CÁCH ĐỌC', 'mấy chỗ dễ nhầm', true)
    dong('', 'Mỗi công đoạn chạy qua TRỌN khối lượng của lệnh. Lệnh 24.784 kg giao 2 công đoạn vẫn là '
      + 'lệnh 24.784 kg, không phải 49.568 kg — nên KHÔNG cộng khối lượng các công đoạn.')
    dong('', '% hoàn thành của LỆNH lấy theo công đoạn CHẬM NHẤT: pha cắt xong 100% mà bảo ôn mới 50% '
      + 'thì lệnh vẫn 50%. Xưởng phải xong hết công đoạn mới tính 100%.')
    dong('', 'Giá trị khoán thì CỘNG các công đoạn, vì mỗi công đoạn có đơn giá riêng cho phần việc riêng. '
      + 'Tiền chỉ tính trên phần ĐÃ NGHIỆM THU; phần mới báo mà chưa ai ký thì không tính.')
    dong('', 'Ô Đơn giá / Thành tiền để TRỐNG nghĩa là chưa nhập đơn giá cho công đoạn đó, khác với 0 '
      + '(đã có đơn giá nhưng chưa nghiệm thu được khối lượng nào).')

    const buf = await wb.xlsx.writeBuffer()
    return new Response(new Uint8Array(buf as ArrayBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${tenFile(loc)}"`,
      },
    })
  } catch (err) {
    console.error('GET /api/reports/khoan-theo-xuong/export error:', err)
    return errorResponse('Lỗi xuất báo cáo khoán theo xưởng', 500)
  }
}
