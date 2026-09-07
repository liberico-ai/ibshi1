import type { NextRequest } from 'next/server'
import type { KhoanFilter } from '@/lib/khoan-report'

/**
 * Đọc bộ lọc báo cáo Khoán theo xưởng từ query string.
 * Màn báo cáo và file Excel dùng CHUNG hàm này, nên file xuất ra luôn khớp với thứ đang xem.
 *
 *   ?xuong=XPC&duAn=<projectId>&tuNgay=2026-09-01&denNgay=2026-09-30
 *
 * Mốc giờ ghim cứng +07:00 chứ không theo múi giờ máy chủ: máy chủ chạy Docker thường là UTC,
 * để nó tự hiểu thì "01/09" thành 07:00 sáng 01/09 giờ VN — lệch mất 7 tiếng đầu kỳ, mà đây
 * là báo cáo chốt khoán theo kỳ nên lệch một ngày là lệch tiền.
 *
 * denNgay lấy TRỌN ngày (tới 23:59:59.999): người dùng chọn 30/09 là có ý tính hết ngày 30.
 */
export function docBoLoc(req: NextRequest): KhoanFilter {
  const q = req.nextUrl.searchParams
  const ngay = (s: string | null, cuoiNgay = false) => {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined
    const d = new Date(`${s}T${cuoiNgay ? '23:59:59.999' : '00:00:00.000'}+07:00`)
    return Number.isNaN(d.getTime()) ? undefined : d
  }
  const tu = q.get('tuNgay')?.trim() || undefined
  const den = q.get('denNgay')?.trim() || undefined
  return {
    teamCode: q.get('xuong')?.trim() || undefined,
    projectId: q.get('duAn')?.trim() || undefined,
    tuNgay: ngay(tu ?? null),
    denNgay: ngay(den ?? null, true),
    // Giữ nguyên chuỗi người dùng gõ để HIỂN THỊ (tên file, tiêu đề sheet, sheet ghi chú).
    // Lấy Date rồi toISOString() sẽ đổi về UTC và tụt mất một ngày.
    tuNgayText: tu,
    denNgayText: den,
  }
}
