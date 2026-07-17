import prisma from '@/lib/db'

/**
 * Sinh mã Đơn đặt hàng kế tiếp — FORMAT CHUẨN (canonical): `PO-<2 số năm>-<3 số>` (vd `PO-26-001`).
 * Reset theo năm, khớp quy ước mã chứng từ (PR, HĐ). Dùng CHUNG cho mọi nơi tạo PO.
 *
 * CHỈ xét mã canonical `PO-<năm>-<số>` của ĐÚNG năm hiện tại — bỏ qua format cũ/lẫn lộn
 * (`PO-NNNNN`, `PO-PR-…`) để tránh bug: max trên tập mã lẫn lộn → parseInt NaN → đụng unique → 500.
 * Có guard va chạm: nếu mã tính ra đã tồn tại thì tăng tiếp (an toàn với dữ liệu lệch/đồng thời).
 *
 * LƯU Ý: KHÔNG rename mã PO cũ (PO-NNNNN, PO-PR-…) — chúng được GRN/hoá đơn/báo cáo tham chiếu;
 * chỉ chuẩn hoá mã MỚI về format năm.
 */
export async function nextPoCode(): Promise<string> {
  const year = new Date().getFullYear().toString().slice(-2)
  const prefix = `PO-${year}-`
  const re = new RegExp(`^PO-${year}-(\\d+)$`)
  const rows = await prisma.purchaseOrder.findMany({
    where: { poCode: { startsWith: prefix } },
    select: { poCode: true },
  })
  let max = 0
  for (const r of rows) {
    const m = re.exec(r.poCode)
    if (m) {
      const n = parseInt(m[1], 10)
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  let seq = max + 1
  let code = `${prefix}${String(seq).padStart(3, '0')}`
  while (await prisma.purchaseOrder.findUnique({ where: { poCode: code } })) {
    seq++
    code = `${prefix}${String(seq).padStart(3, '0')}`
  }
  return code
}
