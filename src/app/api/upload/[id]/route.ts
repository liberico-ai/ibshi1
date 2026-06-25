import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, unauthorizedResponse, successResponse, errorResponse } from '@/lib/auth'
import { unlink } from 'fs/promises'
import path from 'path'

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

    if (attachment.uploadedBy !== user.userId && user.roleCode !== 'R01') {
      return errorResponse('Bạn không có quyền xóa file này', 403)
    }

    try {
      const filePath = path.join(process.cwd(), 'public', attachment.fileUrl)
      await unlink(filePath)
    } catch {
      // File may already be deleted from disk — continue
    }

    await prisma.fileAttachment.delete({ where: { id } })

    return successResponse({})
  } catch (err) {
    console.error('DELETE /api/upload/[id] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
