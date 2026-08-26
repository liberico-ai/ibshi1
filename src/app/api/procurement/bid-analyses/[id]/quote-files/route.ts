import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { saveAttachmentFromBuffer, validateFileName } from '@/lib/save-attachment'

export const dynamic = 'force-dynamic'
const EDIT_ROLES = ['R01', 'R07', 'R07a', 'R10']
const ENTITY = 'BidQuoteFile'

/**
 * File báo giá NCC đính kèm cho 1 đợt BID (khớp Commerce quote-files).
 * GET   → danh sách file báo giá.
 * POST  form-data: file (+ vendorName? tùy chọn) → lưu file.
 * DELETE ?fileId= → gỡ file.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const { id } = await params
    const files = await prisma.fileAttachment.findMany({
      where: { entityType: ENTITY, entityId: id }, orderBy: { createdAt: 'desc' },
      select: { id: true, fileName: true, fileUrl: true, fileSize: true, createdAt: true },
    })
    return successResponse({ files })
  } catch (err) {
    console.error('GET quote-files error:', err)
    return errorResponse('Lỗi tải file báo giá', 500)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, EDIT_ROLES)) return errorResponse('Không có quyền đính kèm báo giá', 403)
  const { id } = await params
  const bid = await prisma.bidAnalysis.findUnique({ where: { id }, select: { id: true } })
  if (!bid) return errorResponse('Không tìm thấy BID', 404)

  let form: FormData
  try { form = await req.formData() } catch { return errorResponse('Yêu cầu phải là form-data có file', 400) }
  const file = form.get('file')
  if (!(file instanceof File)) return errorResponse('Thiếu file báo giá', 400)
  if (file.size > 25 * 1024 * 1024) return errorResponse('File quá lớn (>25MB)', 400)
  // Gắn tên NCC vào tên file để phân biệt (nếu có).
  const vendorName = String(form.get('vendorName') || '').trim()
  const displayName = vendorName ? `[${vendorName}] ${file.name}` : file.name
  const nameErr = validateFileName(file.name)
  if (nameErr) return errorResponse(nameErr, 400)

  const saved = await saveAttachmentFromBuffer({
    buffer: Buffer.from(await file.arrayBuffer()), fileName: displayName,
    entityType: ENTITY, entityId: id, uploadedBy: user.userId,
  })
  return successResponse({ fileName: saved.fileName, fileUrl: saved.fileUrl }, 'Đã đính kèm file báo giá')
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, EDIT_ROLES)) return errorResponse('Không có quyền', 403)
  const { id } = await params
  const fileId = req.nextUrl.searchParams.get('fileId') || ''
  if (!fileId) return errorResponse('Thiếu fileId', 400)
  await prisma.fileAttachment.deleteMany({ where: { id: fileId, entityType: ENTITY, entityId: id } })
  return successResponse({ fileId }, 'Đã gỡ file báo giá')
}
