// Dùng chung cho luồng "Phát hành WO từ ô WBS" (trang Sản xuất).
import { PRODUCTION_WORKSHOPS } from '@/lib/org-map'

// 17 công đoạn WBS (đồng bộ với WbsMilestonesUploadUI + WBS_STAGE_KEYS).
export const WBS_STAGES: { key: string; label: string }[] = [
  { key: 'cutting', label: 'Cắt' }, { key: 'machining', label: 'GCCK' }, { key: 'fitup', label: 'Gá' },
  { key: 'welding', label: 'Hàn' }, { key: 'tryAssembly', label: 'Tổ hợp thử' }, { key: 'dismantle', label: 'Tháo dỡ' },
  { key: 'blasting', label: 'Làm sạch' }, { key: 'galvanize', label: 'Mạ' }, { key: 'repairAfterGalv', label: 'Sửa sau mạ' },
  { key: 'painting', label: 'Sơn' }, { key: 'commissioning', label: 'Chạy thử' }, { key: 'insulation', label: 'Bảo ôn' },
  { key: 'linerPainting', label: 'Sơn liner' }, { key: 'shippingAssembly', label: 'Lắp giao hàng' },
  { key: 'khungKien', label: 'Khung kiện' }, { key: 'packing', label: 'Đóng kiện' }, { key: 'delivery', label: 'Giao hàng' },
]
export const WBS_STAGE_LABEL: Record<string, string> = Object.fromEntries(WBS_STAGES.map(s => [s.key, s.label]))

// woCode tất định cho 1 ô WBS (dùng chung FE + API để idempotent + đánh dấu ô đã phát hành).
export const saniWo = (s: string) => String(s).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// Piece-mark có thể TRÙNG giữa các UNIT (VD MLI1645 ở cả UNIT 1 và UNIT 2 với KL khác nhau) →
// woCode kèm UNIT + STT của dòng để MỖI DÒNG WBS = 1 WO (kể cả 2 dòng trùng tên trong cùng 1 UNIT).
// unitTag/stt rỗng → bỏ đoạn đó (WBS phẳng cũ → mã tương thích).
export const woCodeFor = (projectCode: string, hangMuc: string, stageKey: string, unitTag = '', stt = '') =>
  `WO-${projectCode}-${unitTag ? saniWo(unitTag) + '-' : ''}${stt ? saniWo(stt) + '-' : ''}${saniWo(hangMuc)}-${stageKey}`

// Piece-mark hiển thị/lưu kèm UNIT: "U1 / MLI1634 - Lot 1". Không có UNIT → giữ nguyên hạng mục.
export const pieceMarkFor = (hangMuc: string, unitTag = '') => (unitTag ? `${unitTag} / ${hangMuc}` : hangMuc)

/**
 * UNIT của 1 dòng WBS = dòng "UNIT n" gần nhất phía trên (đi ngược từ rowIndex).
 * Trả "U1"/"U2"… hoặc '' nếu WBS không chia UNIT. Dùng CHUNG FE + API để woCode nhất quán.
 */
export function unitTagForRow(rows: Record<string, string>[], rowIndex: number): string {
  for (let i = Math.min(rowIndex, rows.length - 1); i >= 0; i--) {
    const hm = String(rows[i]?.hangMuc || '').trim()
    const m = hm.match(/^unit\s*0*(\d+)/i)
    if (m) return `U${m[1]}`
  }
  return ''
}

const VALID_WORKSHOP = new Set(PRODUCTION_WORKSHOPS.map(w => w.code)) // XPC, XCT1, XCT2, XH, XHT

/**
 * Chuẩn hóa giá trị ô công đoạn WBS (VD "XPC", "XCT-1", "Thầu phụ", "XCT-1\nThầu phụ") → mã xưởng + cờ thầu phụ.
 * - Bỏ gạch/khoảng trắng: "XCT-1" → "XCT1". Nhận "Thầu phụ" (kèm hoặc không kèm xưởng).
 */
export function normWorkshop(raw: unknown): { teamCode: string; isSub: boolean } {
  const s = String(raw ?? '').replace(/\r?\n/g, ' ').trim()
  const low = s.toLowerCase()
  const isSub = low.includes('thầu') || low.includes('thau') || low.includes('phụ') || low.includes('sub')
  // Tìm mã xưởng hợp lệ trong chuỗi (mỗi token bỏ gạch/khoảng trắng: "XCT-1" → "XCT1").
  let teamCode = ''
  for (const tok of s.split(/[\s/]+/)) {
    const code = tok.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (VALID_WORKSHOP.has(code)) { teamCode = code; break }
  }
  if (!teamCode) teamCode = isSub ? 'THAUPHU' : ''
  return { teamCode, isSub }
}
