import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, unauthorizedResponse, successResponse, errorResponse } from '@/lib/auth'
import { readFile } from 'fs/promises'
import path from 'path'
import { putObject, objectExists, keyFromFileUrl } from '@/lib/minio'

/**
 * JOB MỘT LẦN — đẩy các file upload từ disk (public/uploads) lên MinIO.
 * CHẠY TRÊN PROD (nơi có public/uploads). Chỉ admin (R01/R10).
 *   POST /api/admin/migrate-files-to-minio           → DRY-RUN (đọc, không ghi MinIO)
 *   POST /api/admin/migrate-files-to-minio?apply=1    → GHI thật lên MinIO
 *   &limit=N  giới hạn số file (chạy theo lô nếu cần)
 *
 * Idempotent: file đã có trên MinIO (statObject OK) → skip.
 * KHÔNG đổi FileAttachment.fileUrl (giữ "/uploads/..." — object key = fileUrl bỏ "/" đầu).
 */
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!['R01', 'R10'].includes(user.roleCode)) return errorResponse('Chỉ admin (R01/R10) được chạy job này', 403)

    const { searchParams } = new URL(req.url)
    const apply = searchParams.get('apply') === '1'
    const limit = Math.min(parseInt(searchParams.get('limit') || '5000', 10), 5000)

    const atts = await prisma.fileAttachment.findMany({
      select: { id: true, fileUrl: true, mimeType: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    })

    let migrated = 0, skipped = 0, missing = 0, errors = 0
    const detail: string[] = []

    for (const a of atts) {
      const key = keyFromFileUrl(a.fileUrl)
      try {
        if (await objectExists(key)) { skipped++; continue }
        const buffer = await readFile(path.join(process.cwd(), 'public', a.fileUrl))
        if (apply) await putObject(key, buffer, a.mimeType || 'application/octet-stream')
        migrated++
      } catch (err) {
        const e = err as { code?: string; message?: string }
        if (e?.code === 'ENOENT') { missing++; if (detail.length < 50) detail.push(`MISSING disk: ${a.fileUrl}`) }
        else { errors++; if (detail.length < 50) detail.push(`ERR ${a.fileUrl}: ${e?.message}`) }
      }
    }

    return successResponse({
      mode: apply ? 'APPLY' : 'DRY-RUN',
      total: atts.length,
      migrated, skipped, missing, errors,
      detail,
    })
  } catch (err) {
    console.error('POST /api/admin/migrate-files-to-minio error:', err)
    return errorResponse('Lỗi migrate', 500)
  }
}
