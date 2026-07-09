import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, unauthorizedResponse, successResponse, errorResponse } from '@/lib/auth'
import { readFile, unlink } from 'fs/promises'
import path from 'path'
import { getObjectBuffer, removeObject, keyFromFileUrl, isMinioConfigured } from '@/lib/minio'

// Đọc file: ưu tiên MinIO, fallback disk (file cũ chưa migrate). Ném nếu cả 2 không có.
async function readAttachment(fileUrl: string): Promise<Buffer> {
  if (isMinioConfigured()) {
    try { return await getObjectBuffer(keyFromFileUrl(fileUrl)) } catch { /* thử disk */ }
  }
  return readFile(path.join(process.cwd(), 'public', fileUrl))
}

const INLINE_TYPES = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'text/plain', 'text/csv',
])

// GET /api/upload/[id] — Serve file (authenticated)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { id } = await params
    const attachment = await prisma.fileAttachment.findUnique({ where: { id } })
    if (!attachment) return errorResponse('File không tồn tại', 404)

    let buffer: Buffer
    try {
      buffer = await readAttachment(attachment.fileUrl)
    } catch {
      return errorResponse('File không còn trên kho lưu trữ', 404)
    }

    const mime = attachment.mimeType || 'application/octet-stream'
    const disposition = INLINE_TYPES.has(mime) ? 'inline' : 'attachment'
    const encodedName = encodeURIComponent(attachment.fileName)

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Disposition': `${disposition}; filename*=UTF-8''${encodedName}`,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (err) {
    console.error('GET /api/upload/[id] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// DELETE /api/upload/[id] — Delete a file attachment
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { id } = await params

    const attachment = await prisma.fileAttachment.findUnique({ where: { id } })
    if (!attachment) {
      return errorResponse('File không tồn tại', 404)
    }

    if (attachment.entityType === 'TaskEvidence') {
      const taskId = attachment.entityId.replace(/_evidence$/, '')
      const isAssignee = await prisma.taskAssignee.findFirst({
        where: { taskId, userId: user.userId },
      })
      if (!isAssignee && user.roleCode !== 'R01') {
        return errorResponse('Chỉ người nhận việc được xoá bằng chứng', 403)
      }
    } else if (attachment.uploadedBy !== user.userId && user.roleCode !== 'R01') {
      return errorResponse('Bạn không có quyền xóa file này', 403)
    }

    // Xóa ở cả MinIO và disk (best-effort — file có thể nằm 1 trong 2 tuỳ đã migrate chưa)
    if (isMinioConfigured()) {
      try { await removeObject(keyFromFileUrl(attachment.fileUrl)) } catch { /* ignore */ }
    }
    try { await unlink(path.join(process.cwd(), 'public', attachment.fileUrl)) } catch { /* ignore */ }

    await prisma.fileAttachment.delete({ where: { id } })

    return successResponse({})
  } catch (err) {
    console.error('DELETE /api/upload/[id] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
