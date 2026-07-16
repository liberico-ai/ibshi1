import prisma from '@/lib/db'

/**
 * Sinh mã Đơn đặt hàng kế tiếp dạng `PO-<5 số>`.
 *
 * CHỈ xét mã canonical `PO-<toàn số>` — BỎ QUA định dạng cũ/lẫn lộn
 * (PR-…, PO-PR-…, PO-<năm>-…) để tránh bug nghiêm trọng:
 *   `orderBy poCode desc` trên tập mã lẫn lộn → max ra "PR-115-40" →
 *   parseInt(NaN) → 0 → luôn sinh "PO-00001" → đụng unique → 500 (chặn tạo PO toàn hệ thống).
 *
 * Có guard va chạm: nếu mã tính ra đã tồn tại thì tăng tiếp (an toàn với dữ liệu lệch/đồng thời).
 */
export async function nextPoCode(): Promise<string> {
  const rows = await prisma.purchaseOrder.findMany({
    where: { poCode: { startsWith: 'PO-' } },
    select: { poCode: true },
  })
  let max = 0
  for (const r of rows) {
    const m = /^PO-(\d+)$/.exec(r.poCode)
    if (m) {
      const n = parseInt(m[1], 10)
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  let seq = max + 1
  let code = `PO-${String(seq).padStart(5, '0')}`
  while (await prisma.purchaseOrder.findUnique({ where: { poCode: code } })) {
    seq++
    code = `PO-${String(seq).padStart(5, '0')}`
  }
  return code
}
