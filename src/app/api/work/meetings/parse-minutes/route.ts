import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { parseMom } from '@/lib/mom-parser'
import { DEPT_KEYWORDS, DEPT_PRIMARY_ROLE, DEPT_NAME } from '@/lib/org-map'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Ánh xạ trực tiếp tên phòng trong cột "Người thực hiện" (ưu tiên cao nhất)
const ACTION_BY_DEPT: { re: RegExp; dept: string }[] = [
  { re: /(phòng\s*)?d\.?a\b|dự án/i, dept: 'PSXDA' },
  { re: /(phòng\s*)?sx\b|sản xuất|thầu phụ|tổ\s/i, dept: 'PSXDA' },
  { re: /(phòng\s*)?(tk|thiết kế|kỹ thuật)\b/i, dept: 'PKT' },
  { re: /\bqc\b|qa\/qc|nghiệm thu|chất lượng/i, dept: 'PQAQC' },
  { re: /(phòng\s*)?(tm|thương mại|kinh doanh|mua|cung ứng)\b/i, dept: 'PKTKT' },
  { re: /(kinh tế|ktkt|dự toán|bóc tách)/i, dept: 'PKTKT' },
  { re: /(kế toán|tckt|tài chính|kho|thủ kho|thanh toán)/i, dept: 'PTCKTKHO' },
  { re: /\bhse\b|an toàn/i, dept: 'HSE' },
  { re: /(nhân sự|hcns|tuyển dụng)/i, dept: 'HCNS' },
  { re: /(bgđ|ban giám đốc|giám đốc|phê duyệt)/i, dept: 'BOM' },
]

// Gợi ý phòng cho 1 mục hành động: (1) ánh xạ cột "Người thực hiện" → (2) từ khóa nội dung
function suggestDept(noiDung: string, actionBy: string): { role: string | null; deptName: string | null } {
  const pick = (dept: string) => ({ role: DEPT_PRIMARY_ROLE[dept] || null, deptName: DEPT_NAME[dept] || dept })
  // (1) Người thực hiện ghi rõ phòng
  const ab = actionBy.toLowerCase()
  for (const m of ACTION_BY_DEPT) if (m.re.test(ab)) return pick(m.dept)
  // (2) Quét từ khóa chức năng trong nội dung + người thực hiện
  const text = `${noiDung} ${actionBy}`.toLowerCase()
  let best: { dept: string; score: number } | null = null
  for (const [dept, kws] of Object.entries(DEPT_KEYWORDS)) {
    const score = kws.filter((k) => text.includes(k)).length
    if (score > 0 && (!best || score > best.score)) best = { dept, score }
  }
  return best ? pick(best.dept) : { role: null, deptName: null }
}

// POST /api/work/meetings/parse-minutes — đọc file .xls/.xlsx biên bản họp (mẫu MOM IBS) → dữ liệu có cấu trúc
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const form = await req.formData()
    const file = form.get('file')
    if (!file || typeof file === 'string') return errorResponse('Cần đính kèm file biên bản', 400)
    const name = (file as File).name?.toLowerCase() || ''
    if (!/\.(xls|xlsx)$/.test(name)) return errorResponse('Chỉ hỗ trợ file Excel (.xls/.xlsx)', 400)
    const buf = Buffer.from(await (file as File).arrayBuffer())
    const parsed = parseMom(buf)
    // Gắn gợi ý phòng cho từng mục hành động
    const items = parsed.items.map((it) => ({ ...it, ...suggestDept(it.noiDung, it.actionBy) }))
    return successResponse({ parsed: { ...parsed, items } })
  } catch (err) {
    console.error('POST /api/work/meetings/parse-minutes error:', err)
    return errorResponse('Không đọc được file biên bản. Vui lòng kiểm tra định dạng.', 400)
  }
}
