// Suy trạng thái mua sắm 1 dòng vật tư (khớp Commerce procurementUpdater.inferStatusFlag).
// Thứ tự ưu tiên: nhập kho → nghiệm thu → hàng đang về (≥90%) → đã ký HĐ → đang đàm phán.
export interface StatusInput {
  hasHandover?: boolean        // đã bàn giao/nhập kho
  qcResult?: string | null     // kết quả QC
  arrivedDate?: string | Date | null
  purchasedQty?: number        // tổng đã mua (DOM+IMP)
  reqQty?: number              // SL yêu cầu
  hasContract?: boolean        // đã có số HĐ
}
export function inferStatusFlag(x: StatusInput, current?: string | null): string {
  const req = Number(x.reqQty) || 0
  const bought = Number(x.purchasedQty) || 0
  if (x.hasHandover) return 'Đã nhập kho'
  if (x.qcResult && /pass|đạt|ok/i.test(String(x.qcResult))) return 'Đã nghiệm thu'
  if (x.arrivedDate || (req > 0 && bought >= req * 0.9)) return 'Hàng đang về'
  if (x.hasContract) return 'Đã ký HĐ'
  if (bought > 0) return 'Đang đàm phán'
  return current || 'Chờ báo giá'
}
