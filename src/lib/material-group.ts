// Suy NHÓM VẬT TƯ cho chế độ PER_GROUP (khớp Commerce materialGroup.groupCodeOf).
// itemCode dạng "I95-VTC01-12" → token khớp /^V[A-Z]{2}\d{0,2}$/ ("VTC01") = mã nhóm con.
// Không có mã nhóm → theo mác thép "MAC:<grade>"; cuối cùng "KHAC" (chưa phân nhóm).

export function groupCodeOf(item: { itemCode?: string | null; grade?: string | null }): string {
  const code = String(item?.itemCode || '').trim()
  if (code) {
    const parts = code.split(/[-_\s]/).map(p => p.trim()).filter(Boolean)
    for (const p of parts) if (/^V[A-Z]{2}\d{0,2}$/i.test(p)) return p.toUpperCase()
  }
  const grade = String(item?.grade || '').trim()
  if (grade) return `MAC:${grade}`
  return 'KHAC'
}

export function groupLabelOf(code: string): string {
  if (code === 'KHAC') return 'Chưa phân nhóm'
  if (code.startsWith('MAC:')) return `Mác ${code.slice(4)}`
  return code
}

// Số nhóm THẬT trong danh sách item (dùng cho suggestSelectionMode).
export function uniqueGroupCount(items: Array<{ itemCode?: string | null; grade?: string | null }>): number {
  const s = new Set(items.map(groupCodeOf))
  return s.size || 1
}
