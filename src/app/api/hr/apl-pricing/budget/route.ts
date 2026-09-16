import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit } from '@/lib/auth'
import { saveAttachmentFromBuffer } from '@/lib/save-attachment'
import ExcelJS from 'exceljs'

export const dynamic = 'force-dynamic'

// KTKT tải "Tổng giá trị giao khoán dự án" (1 con số trong file Excel); BGĐ (BOM) duyệt.
const UPLOAD_ROLES = ['R03', 'R03a', 'R01', 'R10'] // KTKT + BGĐ/Admin
const MAX_FILE = 10 * 1024 * 1024

// Chuẩn hoá để dò nhãn: bỏ dấu, thường hoá, gộp khoảng trắng.
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim()
const toNum = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

// Đọc "Tổng giá trị giao khoán" từ file: ưu tiên ô có NHÃN chứa "tong gia tri giao khoan"
// (lấy số cùng dòng, phải sang, hoặc ngay trong ô); không thấy nhãn thì lấy SỐ LỚN NHẤT.
// (Sẽ khớp chính xác theo form khi phòng KTKT gửi mẫu — hiện đọc theo nhãn + fallback.)
function extractBudget(ws: ExcelJS.Worksheet): number {
  const LABELS = ['gia tri giao khoan nhan cong', 'gia tri giao khoan', 'tong gia tri giao khoan', 'tong gia tri khoan', 'tong cong', 'tong gia tri']
  let labelHit = 0
  let maxNum = 0
  ws.eachRow((row) => {
    const cells: { col: number; text: string; num: number }[] = []
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const raw = cell.value
      const text = typeof raw === 'object' && raw && 'result' in raw ? String((raw as { result: unknown }).result ?? '')
        : typeof raw === 'object' && raw && 'text' in raw ? String((raw as { text: unknown }).text ?? '')
          : String(raw ?? '')
      cells.push({ col, text, num: toNum(cell.value) })
      if (toNum(cell.value) > maxNum) maxNum = toNum(cell.value)
    })
    const hasLabel = cells.some(c => LABELS.some(l => norm(c.text).includes(l)))
    if (hasLabel) {
      // Số lớn nhất TRÊN CÙNG DÒNG với nhãn (thường số tiền nằm cạnh nhãn).
      const n = Math.max(0, ...cells.map(c => c.num))
      if (n > labelHit) labelHit = n
    }
  })
  return labelHit > 0 ? labelHit : maxNum
}

// POST (multipart: file, projectId) — KTKT tải file tổng giá trị → lưu con số + file, chờ BGĐ duyệt.
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!UPLOAD_ROLES.includes(user.roleCode)) return errorResponse('Chỉ KTKT/BGĐ được tải Tổng giá trị giao khoán', 403)

  const fd = await req.formData()
  const file = fd.get('file') as File | null
  const projectId = String(fd.get('projectId') || '')
  if (!projectId) return errorResponse('Thiếu projectId', 400)
  if (!file) return errorResponse('Chưa chọn file', 400)
  if (file.size > MAX_FILE) return errorResponse('File quá lớn (tối đa 10MB)', 400)

  const imp = await prisma.aplImport.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' }, select: { id: true } })
  if (!imp) return errorResponse('Dự án chưa có bảng APL', 404)

  const buf = Buffer.from(await file.arrayBuffer())
  let wb: ExcelJS.Workbook
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  try { wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any) }
  catch { return errorResponse('File không đọc được (phải là .xlsx)', 400) }
  const ws = wb.worksheets[0]
  if (!ws) return errorResponse('File rỗng', 400)
  const budgetTotal = extractBudget(ws)
  if (!(budgetTotal > 0)) return errorResponse('Không tìm thấy giá trị số trong file — kiểm tra lại file tổng giá trị', 400)

  const att = await saveAttachmentFromBuffer({ buffer: buf, fileName: file.name, entityType: 'AplBudget', entityId: imp.id, uploadedBy: user.userId })

  await prisma.aplPricing.upsert({
    where: { importId: imp.id },
    create: { importId: imp.id, status: 'DRAFT', budgetTotal, budgetFileId: att.id, budgetStatus: 'PENDING' },
    update: { budgetTotal, budgetFileId: att.id, budgetStatus: 'PENDING', budgetApprovedBy: null, budgetApprovedAt: null },
  })
  await logAudit(user.userId, 'UPDATE', 'AplPricing', imp.id, { action: 'budget_upload', budgetTotal, fileName: file.name })
  return successResponse({ budgetTotal, budgetFileUrl: att.fileUrl, budgetStatus: 'PENDING' }, `Đã tải Tổng giá trị giao khoán: ${budgetTotal.toLocaleString('vi-VN')} ₫ — chờ BGĐ duyệt`)
}

// POST không dùng — duyệt/mở lại nằm ở /budget/approve. GET trả trạng thái hiện tại.
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  const projectId = new URL(req.url).searchParams.get('projectId') || ''
  if (!projectId) return errorResponse('Thiếu projectId', 400)
  const imp = await prisma.aplImport.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' }, select: { id: true } })
  if (!imp) return successResponse({ budget: null })
  const pr = await prisma.aplPricing.findUnique({ where: { importId: imp.id }, select: { budgetTotal: true, budgetStatus: true, budgetFileId: true, budgetApprovedAt: true } })
  let fileUrl: string | null = null
  if (pr?.budgetFileId) fileUrl = (await prisma.fileAttachment.findUnique({ where: { id: pr.budgetFileId }, select: { fileUrl: true } }))?.fileUrl ?? null
  return successResponse({ budget: pr ? { total: Number(pr.budgetTotal || 0), status: pr.budgetStatus, fileUrl, approvedAt: pr.budgetApprovedAt } : null })
}
