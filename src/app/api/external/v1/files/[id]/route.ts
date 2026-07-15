import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { errorResponse } from '@/lib/auth'
import { authenticateApiClient, requireScope } from '@/lib/api-auth'
import { readFile } from 'fs/promises'
import path from 'path'
import { getObjectBuffer, keyFromFileUrl, isMinioConfigured } from '@/lib/minio'

export const dynamic = 'force-dynamic'

async function readAttachment(fileUrl: string): Promise<Buffer> {
  if (isMinioConfigured()) {
    try { return await getObjectBuffer(keyFromFileUrl(fileUrl)) } catch { /* fallback disk */ }
  }
  return readFile(path.join(process.cwd(), 'public', fileUrl))
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const client = await authenticateApiClient(req)
  if (!client) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED')
  if (!requireScope(client, 'read:tasks')) return errorResponse('Insufficient scope', 403, 'INSUFFICIENT_SCOPE')

  const { id } = await params
  const attachment = await prisma.fileAttachment.findUnique({ where: { id } })
  if (!attachment) return errorResponse('File not found', 404, 'NOT_FOUND')

  // Only allow downloading files attached to sale-originated tasks
  const taskId = attachment.entityId.replace(/_.+$/, '')
  const task = await prisma.task.findFirst({
    where: { id: taskId, externalSource: 'sale' },
    select: { id: true },
  })
  if (!task) return errorResponse('File not associated with a sale task', 403, 'FORBIDDEN')

  let buffer: Buffer
  try {
    buffer = await readAttachment(attachment.fileUrl)
  } catch {
    return errorResponse('File not available on storage', 404, 'NOT_FOUND')
  }

  const mime = attachment.mimeType || 'application/octet-stream'
  const encodedName = encodeURIComponent(attachment.fileName)

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodedName}`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
