import { NextRequest } from 'next/server'
import * as XLSX from 'xlsx'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { buildKhoanReport } from '@/lib/khoan-report'

export const dynamic = 'force-dynamic'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/khoan-theo-xuong/export?muc=tat-ca|xuong|lenh|cong-doan
//
// Xuất báo cáo Khoán theo xưởng ra Excel. Chọn được mức chi tiết vì mỗi người cần một kiểu:
// Ban giám đốc chỉ xem tổng theo xưởng, KTKH cần tới từng công đoạn để đối chiếu đơn giá.
//
// Số liệu lấy từ CHÍNH lõi mà màn báo cáo đang dùng (buildKhoanReport) — không tính lại,
// nên file xuất ra không bao giờ lệch với màn hình.
//
// Phạm vi cũng theo đúng luật của màn báo cáo: xưởng chỉ xuất được xưởng mình.
// ─────────────────────────────────────────────────────────────────────────────

type Muc = 'tat-ca' | 'xuong' | 'lenh' | 'cong-doan'
const MUC: Record<Muc, string> = {
  'tat-ca': 'ToanBo',
  'xuong': 'TheoXuong',
  'lenh': 'TheoLenh',
  'cong-doan': 'TheoCongDoan',
}

/** Ngày giờ đặt tên file, theo giờ VN — tránh hai lần xuất trong ngày đè lên nhau. */
function dauThoiGian() {
  const d = new Date(Date.now() + 7 * 3600 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`
}

const pct = (r: number) => Math.round(r * 100) / 100   // Excel định dạng % nên giữ dạng tỉ lệ
const num = (n: number) => Math.round(n * 100) / 100

export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const raw = (req.nextUrl.searchParams.get('muc') || 'tat-ca') as Muc
    const muc: Muc = raw in MUC ? raw : 'tat-ca'

    const { workshops, totals, scopeMissing } = await buildKhoanReport(user.userId, user.roleCode)
    if (scopeMissing) {
      return errorResponse('Tài khoản chưa gắn xưởng nên không có dữ liệu để xuất', 403)
    }
    if (workshops.length === 0) {
      return errorResponse('Chưa có lệnh sản xuất nào để xuất', 404)
    }

    const wb = XLSX.utils.book_new()

    // ── Sheet: tổng theo XƯỞNG ──
    const themXuong = () => {
      const rows = workshops.map(w => ({
        'Mã xưởng': w.teamCode,
        'Xưởng': w.teamName,
        'Số dự án': w.projectCount,
        'Số lệnh': w.woCount,
        'KL giao': num(w.plannedKg),
        'Đã báo': num(w.reportedKg),
        'Đã nghiệm thu': num(w.acceptedKg),
        'Hoàn thành': pct(w.ratio),
        'Giá trị khoán': Math.round(w.amount),
        'Lệnh chưa có đơn giá': w.woWithoutPrice,
      }))
      const ws = XLSX.utils.json_to_sheet(rows)
      ws['!cols'] = [12, 22, 10, 10, 14, 14, 16, 12, 18, 20].map(wch => ({ wch }))
      XLSX.utils.book_append_sheet(wb, ws, 'Theo xưởng')
    }

    // ── Sheet: tới từng LỆNH ──
    const themLenh = () => {
      const rows = workshops.flatMap(w => w.projects.flatMap(p => p.wos.map(o => ({
        'Mã xưởng': w.teamCode,
        'Xưởng': w.teamName,
        'Mã dự án': p.projectCode,
        'Dự án': p.projectName,
        'Lệnh SX': o.woCode,
        'Hạng mục (ITEM)': o.item || '',
        'Trạng thái': o.status,
        'Số công đoạn': o.stages.length,
        'KL giao': num(o.plannedKg),
        'Đã báo': num(o.reportedKg),
        'Đã nghiệm thu': num(o.acceptedKg),
        'Hoàn thành': pct(o.ratio),
        'Giá trị khoán': o.amount === null ? '' : Math.round(o.amount),
      }))))
      const ws = XLSX.utils.json_to_sheet(rows)
      ws['!cols'] = [12, 20, 16, 26, 42, 30, 14, 12, 14, 14, 16, 12, 18].map(wch => ({ wch }))
      XLSX.utils.book_append_sheet(wb, ws, 'Theo lệnh')
    }

    // ── Sheet: tới từng CÔNG ĐOẠN ──
    // Lệnh không chia công đoạn vẫn ra MỘT dòng, ghi rõ "(không chia công đoạn)" — bỏ hẳn
    // thì tổng của sheet này hụt so với sheet Theo lệnh mà người đọc không biết vì sao.
    const themCongDoan = () => {
      const rows = workshops.flatMap(w => w.projects.flatMap(p => p.wos.flatMap(o => (
        o.stages.length > 0
          ? o.stages.map(st => ({
            'Mã xưởng': w.teamCode,
            'Xưởng': w.teamName,
            'Mã dự án': p.projectCode,
            'Dự án': p.projectName,
            'Lệnh SX': o.woCode,
            'Hạng mục (ITEM)': o.item || '',
            'Mã công đoạn': st.stageCode,
            'Công đoạn': st.name,
            'Chủng loại': st.category || '',
            'Đơn vị': st.unit,
            'KL giao': num(st.plannedKg),
            'Đã báo': num(st.reportedKg),
            'Đã nghiệm thu': num(st.acceptedKg),
            'Hoàn thành': pct(st.ratio),
            'Đơn giá': st.unitPrice === null ? '' : st.unitPrice,
            'Thành tiền': st.unitPrice === null ? '' : Math.round(st.amount ?? 0),
          }))
          : [{
            'Mã xưởng': w.teamCode,
            'Xưởng': w.teamName,
            'Mã dự án': p.projectCode,
            'Dự án': p.projectName,
            'Lệnh SX': o.woCode,
            'Hạng mục (ITEM)': o.item || '',
            'Mã công đoạn': '',
            'Công đoạn': '(không chia công đoạn)',
            'Chủng loại': '',
            'Đơn vị': 'kg',
            'KL giao': num(o.plannedKg),
            'Đã báo': num(o.reportedKg),
            'Đã nghiệm thu': num(o.acceptedKg),
            'Hoàn thành': pct(o.ratio),
            'Đơn giá': '',
            'Thành tiền': o.amount === null ? '' : Math.round(o.amount),
          }]
      ))))
      const ws = XLSX.utils.json_to_sheet(rows)
      ws['!cols'] = [12, 20, 16, 26, 42, 30, 14, 18, 34, 10, 14, 14, 16, 12, 14, 18].map(wch => ({ wch }))
      XLSX.utils.book_append_sheet(wb, ws, 'Theo công đoạn')
    }

    if (muc === 'xuong') themXuong()
    else if (muc === 'lenh') themLenh()
    else if (muc === 'cong-doan') themCongDoan()
    else { themXuong(); themLenh(); themCongDoan() }

    // ── Sheet ghi chú: nói rõ mấy con số dễ đọc nhầm ──
    const wsGhiChu = XLSX.utils.aoa_to_sheet([
      ['BÁO CÁO KHOÁN THEO XƯỞNG'],
      ['Xuất lúc', new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' (giờ VN)'],
      ['Người xuất', user.fullName || user.username],
      ['Mức chi tiết', muc === 'xuong' ? 'Theo xưởng'
        : muc === 'lenh' ? 'Theo lệnh'
          : muc === 'cong-doan' ? 'Theo công đoạn' : 'Toàn bộ (cả ba mức)'],
      [],
      ['Tổng khối lượng — mỗi hạng mục đếm MỘT lần'],
      ['KL giao', num(totals.plannedKg)],
      ['Đã báo', num(totals.reportedKg)],
      ['Đã nghiệm thu', num(totals.acceptedKg)],
      ['Tổng khối lượng VIỆC (cộng ngang các xưởng)', num(totals.workloadKg)],
      [],
      ['Cách đọc mấy con số dễ nhầm'],
      ['', 'Mỗi công đoạn chạy qua TRỌN khối lượng của lệnh. Lệnh 24.784 kg giao 2 công đoạn'],
      ['', 'vẫn là lệnh 24.784 kg, không phải 49.568 kg — nên KHÔNG cộng khối lượng các công đoạn.'],
      [],
      ['', '% hoàn thành của LỆNH lấy theo công đoạn CHẬM NHẤT: pha cắt xong 100% mà bảo ôn mới'],
      ['', '50% thì lệnh vẫn 50%. Xưởng phải xong hết công đoạn mới tính 100%.'],
      [],
      ['', 'Giá trị khoán thì CỘNG các công đoạn, vì mỗi công đoạn có đơn giá riêng cho phần việc'],
      ['', 'riêng của nó. Tiền chỉ tính trên phần ĐÃ NGHIỆM THU, phần mới báo chưa ký không tính.'],
      [],
      ['', 'Tổng khối lượng ở trên đếm mỗi hạng mục một lần, nên KHÔNG bằng tổng cộng ngang các'],
      ['', 'xưởng — một hạng mục giao 5 xưởng thì 5 xưởng đều nhận trọn khối lượng đó.'],
      [],
      ['', 'Ô Đơn giá / Thành tiền để TRỐNG nghĩa là chưa nhập đơn giá cho công đoạn đó,'],
      ['', 'khác với 0 (đã có đơn giá nhưng chưa nghiệm thu được khối lượng nào).'],
    ])
    wsGhiChu['!cols'] = [{ wch: 44 }, { wch: 88 }]
    XLSX.utils.book_append_sheet(wb, wsGhiChu, 'Ghi chú')

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="KhoanTheoXuong-${MUC[muc]}-${dauThoiGian()}.xlsx"`,
      },
    })
  } catch (err) {
    console.error('GET /api/reports/khoan-theo-xuong/export error:', err)
    return errorResponse('Lỗi xuất báo cáo khoán theo xưởng', 500)
  }
}
