import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { saveAttachmentFromBuffer, validateFileName } from '@/lib/save-attachment'

export const dynamic = 'force-dynamic'
// Đính kèm / gỡ FILE GIẢI TRÌNH đã ký cho 1 đợt BID có sẵn (gộp vào màn Bidding, khớp Commerce).
const EDIT_ROLES = ['R01', 'R03', 'R03a', 'R07', 'R07a', 'R10']

// POST /api/procurement/bid-analyses/[id]/source-file — form-data: file (+ legacyBidCode? tùy chọn)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, EDIT_ROLES)) return errorResponse('Không có quyền đính kèm giải trình', 403)
  const { id } = await params

  const bid = await prisma.bidAnalysis.findUnique({ where: { id }, select: { id: true } })
  if (!bid) return errorResponse('Không tìm thấy BID', 404)

  let form: FormData
  try { form = await req.formData() } catch { return errorResponse('Yêu cầu phải là form-data có file', 400) }
  const file = form.get('file')
  if (!(file instanceof File)) return errorResponse('Thiếu file giải trình', 400)
  if (file.size > 25 * 1024 * 1024) return errorResponse('File quá lớn (>25MB)', 400)
  const nameErr = validateFileName(file.name)
  if (nameErr) return errorResponse(nameErr, 400)

  const saved = await saveAttachmentFromBuffer({
    buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name,
    entityType: 'BidGiaiTrinh', entityId: id, uploadedBy: user.userId,
  })

  const legacyBidCode = String(form.get('legacyBidCode') || '').trim() || undefined
  const updated = await prisma.bidAnalysis.update({
    where: { id },
    data: { sourceFileName: saved.fileName, sourceFilePath: saved.fileUrl, ...(legacyBidCode ? { legacyBidCode } : {}) },
    select: { id: true, sourceFileName: true, sourceFilePath: true, legacyBidCode: true },
  })
  return successResponse({ bid: updated }, 'Đã đính kèm file giải trình')
}

// DELETE /api/procurement/bid-analyses/[id]/source-file — gỡ file giải trình khỏi BID (không xóa BID)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, EDIT_ROLES)) return errorResponse('Không có quyền gỡ giải trình', 403)
  const { id } = await params

  const bid = await prisma.bidAnalysis.findUnique({ where: { id }, select: { id: true } })
  if (!bid) return errorResponse('Không tìm thấy BID', 404)

  await prisma.fileAttachment.deleteMany({ where: { entityType: 'BidGiaiTrinh', entityId: id } })
  await prisma.bidAnalysis.update({ where: { id }, data: { sourceFileName: null, sourceFilePath: null } })
  return successResponse({ id }, 'Đã gỡ file giải trình')
}
