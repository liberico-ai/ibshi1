import { NextRequest } from 'next/server'
import * as XLSX from 'xlsx'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { parseMisaLedger } from '@/lib/misa-ledger-parser'

export const dynamic = 'force-dynamic'
const LEDGER_ROLES = ['R01', 'R03', 'R03a', 'R08', 'R08a', 'R10'] // Kế toán + KTKH + BGĐ + IT

const normCode = (s: string) => s.replace(/\s+/g, '').toUpperCase()

// POST /api/reports/ledger/import — form-data: file (xlsx), sheetName?, note?
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, LEDGER_ROLES)) return errorResponse('Không có quyền nhập bảng kê kế toán', 403)

  let form: FormData
  try { form = await req.formData() } catch { return errorResponse('Yêu cầu phải là form-data có file', 400) }
  const file = form.get('file')
  if (!(file instanceof File)) return errorResponse('Thiếu file bảng kê', 400)
  if (file.size > 25 * 1024 * 1024) return errorResponse('File quá lớn (>25MB)', 400)
  if (!/\.(xlsx|xls)$/i.test(file.name)) return errorResponse('Chỉ nhận file Excel (.xlsx/.xls)', 400)
  const note = String(form.get('note') || '').trim() || null
  const pickSheet = String(form.get('sheetName') || '').trim()

  let wb: XLSX.WorkBook
  try { wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: 'buffer' }) }
  catch { return errorResponse('Không đọc được file Excel', 400) }

  // Chọn sheet: theo tên nếu có, else sheet đầu tiên parse được
  const sheetNames = pickSheet ? [pickSheet] : wb.SheetNames
  let parsed: ReturnType<typeof parseMisaLedger> | null = null
  let usedSheet = ''
  for (const sn of sheetNames) {
    const ws = wb.Sheets[sn]; if (!ws) continue
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as unknown[][]
    const r = parseMisaLedger(grid)
    if (r.ok) { parsed = r; usedSheet = sn; break }
    if (pickSheet) { parsed = r; usedSheet = sn; break } // sheet chỉ định mà lỗi → trả lỗi đó
  }
  if (!parsed) return errorResponse(`Không sheet nào đọc được. Có: ${wb.SheetNames.join(', ')}`, 400)
  if (!parsed.ok) return errorResponse(`Sheet "${usedSheet}": ${parsed.error}`, 400)

  // Khớp Vụ việc → dự án theo projectCode (chuẩn hoá bỏ khoảng trắng, hoa)
  const projects = await prisma.project.findMany({ select: { id: true, projectCode: true } })
  const codeMap = new Map(projects.map(p => [normCode(p.projectCode), p.id]))
  const unmatched = new Set<string>()
  const rows = parsed.rows.map(r => {
    const pid = r.vuViec ? codeMap.get(normCode(r.vuViec)) || null : null
    if (r.vuViec && !pid) unmatched.add(r.vuViec)
    return { ...r, projectId: pid }
  })
  const matchedRows = rows.filter(r => r.projectId).length

  const batch = await prisma.ledgerImportBatch.create({
    data: {
      fileName: file.name.slice(0, 250), note,
      rowCount: rows.length, matchedRows,
      totalDebit: parsed.totalDebit, totalCredit: parsed.totalCredit,
      importedBy: user.userId,
    },
  })

  // Chèn entries theo lô 1000
  const data = rows.map(r => ({
    batchId: batch.id,
    entryDate: r.entryDate ? new Date(r.entryDate) : new Date(0),
    docType: r.docType, docNo: r.docNo, partnerCode: r.partnerCode, partnerName: r.partnerName,
    description: r.description, account: r.account, contraAccount: r.contraAccount,
    debit: r.debit, credit: r.credit, vuViec: r.vuViec, projectId: r.projectId,
  }))
  for (let i = 0; i < data.length; i += 1000) {
    await prisma.ledgerEntry.createMany({ data: data.slice(i, i + 1000) })
  }

  return successResponse({
    batchId: batch.id, sheet: usedSheet,
    rowCount: rows.length, matchedRows, unmatchedCount: rows.length - matchedRows,
    unmatchedVuViec: [...unmatched].slice(0, 50),
    totalDebit: parsed.totalDebit, totalCredit: parsed.totalCredit,
  }, `Đã nhập ${rows.length} dòng (khớp dự án: ${matchedRows})`, 201)
}
