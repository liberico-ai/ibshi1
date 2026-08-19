import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { saveAttachmentFromBuffer, validateFileName } from '@/lib/save-attachment'

export const dynamic = 'force-dynamic'
// Giải trình Mua Sắm Đấu Thầu (MSDT) — khớp Commerce: mỗi giải trình = 1 BidAnalysis rút gọn + file gốc đã ký.
const EDIT_ROLES = ['R01', 'R03', 'R03a', 'R07', 'R07a', 'R10'] // KTKT/Thương mại + BGĐ + IT
const sani = (s: string) => String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// GET /api/procurement/bid-analyses/giai-trinh?projectId= — danh sách giải trình (có file đính kèm)
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const projectId = new URL(req.url).searchParams.get('projectId') || undefined
  const rows = await prisma.bidAnalysis.findMany({
    where: { sourceFilePath: { not: null }, ...(projectId ? { projectId } : {}) },
    select: {
      id: true, legacyBidCode: true, bidCode: true, subject: true, bidDate: true, notes: true,
      sourceFileName: true, sourceFilePath: true, status: true, createdAt: true,
      project: { select: { projectCode: true, projectName: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return successResponse({ rows, canEdit: requireRoles(user.roleCode, EDIT_ROLES) })
}

// POST /api/procurement/bid-analyses/giai-trinh — form-data: projectId?, legacyBidCode, subject?, bidDate?, notes?, file
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, EDIT_ROLES)) return errorResponse('Không có quyền thêm giải trình đấu thầu', 403)

  let form: FormData
  try { form = await req.formData() } catch { return errorResponse('Yêu cầu phải là form-data có file', 400) }
  const file = form.get('file')
  if (!(file instanceof File)) return errorResponse('Thiếu file giải trình', 400)
  if (file.size > 25 * 1024 * 1024) return errorResponse('File quá lớn (>25MB)', 400)
  const nameErr = validateFileName(file.name)
  if (nameErr) return errorResponse(nameErr, 400)

  const legacyBidCode = String(form.get('legacyBidCode') || '').trim()
  if (!legacyBidCode) return errorResponse('Nhập Số / mã giải trình (VD "MSDT 401")', 400)
  const projectId = String(form.get('projectId') || '').trim() || null
  const subject = String(form.get('subject') || '').trim() || null
  const notes = String(form.get('notes') || '').trim() || null
  const bidDateStr = String(form.get('bidDate') || '').trim()
  const bidDate = bidDateStr ? new Date(bidDateStr) : null

  let projectCode = 'NA'
  if (projectId) {
    const p = await prisma.project.findUnique({ where: { id: projectId }, select: { projectCode: true } })
    if (!p) return errorResponse('Không tìm thấy dự án', 404)
    projectCode = p.projectCode
  }

  // Sinh bidCode duy nhất: GT-{dự án}-{mã cũ}; đụng thì thêm đuôi.
  let bidCode = `GT-${sani(projectCode)}-${sani(legacyBidCode) || 'BID'}`
  if (await prisma.bidAnalysis.findUnique({ where: { bidCode }, select: { id: true } })) {
    bidCode = `${bidCode}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
  }

  // Tạo phiếu rút gọn trước → lấy id làm entityId lưu file → cập nhật đường dẫn file.
  const ba = await prisma.bidAnalysis.create({
    data: { bidCode, legacyBidCode, projectId, subject, bidDate, notes, status: 'SELECTED', createdBy: user.userId },
    select: { id: true },
  })

  const saved = await saveAttachmentFromBuffer({
    buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name,
    entityType: 'BidGiaiTrinh', entityId: ba.id, uploadedBy: user.userId,
  })

  const updated = await prisma.bidAnalysis.update({
    where: { id: ba.id },
    data: { sourceFileName: saved.fileName, sourceFilePath: saved.fileUrl },
    select: { id: true, bidCode: true, legacyBidCode: true, sourceFileName: true, sourceFilePath: true },
  })
  return successResponse({ giaiTrinh: updated }, `Đã lưu giải trình "${legacyBidCode}"`, 201)
}

// DELETE /api/procurement/bid-analyses/giai-trinh?id= — xóa 1 giải trình (chỉ phiếu rút gọn có file)
export async function DELETE(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, EDIT_ROLES)) return errorResponse('Không có quyền xóa giải trình', 403)

  const id = new URL(req.url).searchParams.get('id') || ''
  if (!id) return errorResponse('Thiếu id', 400)
  const ba = await prisma.bidAnalysis.findUnique({ where: { id }, select: { id: true, sourceFilePath: true, items: { select: { id: true }, take: 1 } } })
  if (!ba) return errorResponse('Không tìm thấy giải trình', 404)
  if (ba.items.length > 0) return errorResponse('Phiếu này có dữ liệu đấu thầu chi tiết — không xóa ở đây', 409)
  await prisma.bidAnalysis.delete({ where: { id } })
  return successResponse({ id }, 'Đã xóa giải trình')
}
