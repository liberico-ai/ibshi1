import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, unauthorizedResponse } from '@/lib/auth'
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
      return NextResponse.json({ ok: false, error: 'File không tồn tại' }, { status: 404 })
    }

    // Only uploader or admin (R01) can delete
    if (attachment.uploadedBy !== user.userId && user.roleCode !== 'R01') {
      return NextResponse.json({ ok: false, error: 'Bạn không có quyền xóa file này' }, { status: 403 })
    }

    // Delete from filesystem (non-blocking, ignore errors for missing files)
    try {
      const filePath = path.join(process.cwd(), 'public', attachment.fileUrl)
      await unlink(filePath)
    } catch {
      // File may already be deleted from disk — continue
    }

    // Delete DB record
    await prisma.fileAttachment.delete({ where: { id } })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/upload/[id] error:', err)
    return NextResponse.json({ ok: false, error: 'Lỗi hệ thống' }, { status: 500 })
  }
}
